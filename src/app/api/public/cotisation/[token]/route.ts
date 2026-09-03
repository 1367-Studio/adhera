import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { stripe, connectAccountChargesEnabled } from "@/lib/stripe"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { parseModules } from "@/lib/modules"
import { nextAmountDue } from "@/lib/cotisation-status"

// Public "pay your cotisation" flow for the tokenized link emailed when an admin creates a
// member from the dashboard (see POST /api/membres + invitationEmail's payUrl) — the member
// pays without logging in, so the authenticated flow at
// src/app/api/portal/cotisation/checkout/route.ts isn't a prerequisite. Reached via the
// unguessable Cotisation.paymentToken, same convention as cancel-ticket's cancelToken.
// Payment settlement is unchanged: the Stripe session carries the same metadata as the
// portal flow, so the existing webhook marks the cotisation paid.

const PAYABLE = ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] as const

async function findByToken(token: string) {
  return prisma.cotisation.findUnique({
    where:   { paymentToken: token },
    include: {
      membre:       { select: { firstName: true, lastName: true } },
      association:  { select: { name: true, slug: true, stripeConnectId: true, modules: true } },
      installments: { orderBy: { dueDate: "asc" }, select: { amount: true, dueDate: true, order: true } },
    },
  })
}

function amountDueOf(c: NonNullable<Awaited<ReturnType<typeof findByToken>>>): number {
  return nextAmountDue({
    amount:       Number(c.amount),
    amountPaid:   Number(c.amountPaid),
    installments: c.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Purely informational and gated by a 160-bit token already, but rate-limited anyway
  // for consistency with every other public endpoint in this app.
  if (!(await rateLimit(`cotisation-pay-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const cotisation = await findByToken(token)
  if (!cotisation || !parseModules(cotisation.association.modules).cotisations) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  }

  return NextResponse.json({
    associationName: cotisation.association.name,
    firstName:       cotisation.membre.firstName,
    lastName:        cotisation.membre.lastName,
    year:            cotisation.year,
    amountDue:       amountDueOf(cotisation),
    paid:            !(PAYABLE as readonly string[]).includes(cotisation.status),
    // Whether a Stripe account is even connected — the charges-enabled roundtrip to Stripe
    // stays in POST, where it actually gates money movement.
    online:          !!cotisation.association.stripeConnectId,
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`cotisation-pay:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const cotisation = await findByToken(token)
  if (!cotisation || !parseModules(cotisation.association.modules).cotisations) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  }
  if (!(PAYABLE as readonly string[]).includes(cotisation.status)) {
    return NextResponse.json({ error: "Cette cotisation est déjà réglée" }, { status: 409 })
  }

  if (!cotisation.association.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })
  if (!(await connectAccountChargesEnabled(cotisation.association.stripeConnectId)))
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const amountDue   = amountDueOf(cotisation)
  const amountCents = Math.round(amountDue * 100)
  if (amountCents <= 0) {
    return NextResponse.json({ error: "Aucun solde restant à payer" }, { status: 409 })
  }

  // Same session-reuse-or-expire dance as the portal checkout — see the comment there
  // (src/app/api/portal/cotisation/checkout/route.ts) for why a stale open session must be
  // expired rather than ignored. Both flows share Cotisation.stripeSessionId on purpose, so
  // a member clicking the email link and the portal button can never hold two live sessions.
  if (cotisation.stripeSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(cotisation.stripeSessionId).catch(() => null)
    if (existingSession?.status === "open") {
      if (existingSession.amount_total === amountCents && existingSession.url) {
        return NextResponse.json({ url: existingSession.url })
      }
      await stripe.checkout.sessions.expire(existingSession.id).catch(() => {})
    }
  }

  const amountPaid  = Number(cotisation.amountPaid)
  const productName = cotisation.installments.length > 0
    ? `${cotisation.association.name} — Cotisation ${cotisation.year} (échéance)`
    : amountPaid > 0
      ? `${cotisation.association.name} — Cotisation ${cotisation.year} (solde restant)`
      : `${cotisation.association.name} — Cotisation ${cotisation.year}`

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: productName },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      transfer_data: { destination: cotisation.association.stripeConnectId },
      metadata:      { cotisationId: cotisation.id, associationId: cotisation.associationId },
    },
    metadata:    { cotisationId: cotisation.id },
    success_url: `${APP_URL}/cotisation/${token}?payment=success`,
    cancel_url:  `${APP_URL}/cotisation/${token}?payment=cancelled`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })

  await prisma.cotisation.update({
    where: { id: cotisation.id },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url })
}

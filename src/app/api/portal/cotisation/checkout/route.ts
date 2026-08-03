import { NextResponse } from "next/server"
import { stripe, connectAccountChargesEnabled, PLATFORM_FEE } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { withPortalAuth } from "@/lib/api-wrapper"
import { nextAmountDue } from "@/lib/cotisation-status"

export const POST = withPortalAuth(async (req, ctx) => {
  const { cotisationId } = await req.json()
  if (!cotisationId) return NextResponse.json({ error: "cotisationId requis" }, { status: 422 })

  const cotisation = await prisma.cotisation.findFirst({
    where:   { id: cotisationId, membreId: ctx.membreId!, status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] } },
    include: {
      association:  { select: { stripeConnectId: true, name: true, slug: true } },
      installments: { orderBy: { dueDate: "asc" }, select: { amount: true, dueDate: true, order: true } },
    },
  })
  if (!cotisation)
    return NextResponse.json({ error: "Cotisation introuvable ou déjà réglée" }, { status: 404 })

  if (!cotisation.association.stripeConnectId || !cotisation.association.slug)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })
  if (!(await connectAccountChargesEnabled(cotisation.association.stripeConnectId)))
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const amountPaid = Number(cotisation.amountPaid)
  const amount     = Number(cotisation.amount)
  // When the cotisation has an installment schedule, this charges only what's needed to
  // catch up through the next unpaid installment — not the whole remaining balance — so a
  // member can pay a parcelamento one échéance at a time instead of always being asked for
  // everything left. Falls back to the full remaining balance when there's no schedule
  // (unchanged behavior from before installments existed).
  const amountDue   = nextAmountDue({
    amount, amountPaid,
    installments: cotisation.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  })
  const amountCents = Math.round(amountDue * 100)
  if (amountCents <= 0) {
    return NextResponse.json({ error: "Aucun solde restant à payer" }, { status: 409 })
  }

  // Reuse an already-open Stripe checkout session instead of minting a new one on every
  // click/retry — otherwise a member can end up with two valid payable sessions for the
  // same due, and completing both would double-charge them. Only reused when it's still
  // priced at exactly what we'd charge now: a payment recorded (by an admin, say) between
  // this session being created and this second click would make an old session stale —
  // reusing it would let it be completed at the old, larger amount. When that's the case,
  // the stale session is expired outright instead of just being ignored, so it can never
  // be completed by, e.g., a tab the member still has open on it.
  if (cotisation.stripeSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(cotisation.stripeSessionId).catch(() => null)
    if (existingSession?.status === "open") {
      if (existingSession.amount_total === amountCents && existingSession.url) {
        return NextResponse.json({ url: existingSession.url })
      }
      await stripe.checkout.sessions.expire(existingSession.id).catch(() => {})
    }
  }

  const applicationFee = Math.round(amountCents * PLATFORM_FEE)
  const slug        = cotisation.association.slug
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
          product_data: {
            name: productName,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: cotisation.association.stripeConnectId },
      metadata:               { cotisationId, associationId: ctx.associationId },
    },
    metadata:    { cotisationId },
    success_url: `${APP_URL}/portal/${slug}/cotisation?payment=success`,
    cancel_url:  `${APP_URL}/portal/${slug}/cotisation?payment=cancelled`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })

  await prisma.cotisation.update({
    where: { id: cotisationId },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url })
}, { module: "cotisations" })

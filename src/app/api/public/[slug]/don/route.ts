import { NextResponse } from "next/server"
import { z } from "zod"
import { stripe, connectAccountChargesEnabled, PLATFORM_FEE } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { isValidSiret } from "@/lib/siret"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { name: true, modules: true, canIssueTaxReceipts: true, stripeConnectId: true },
  })

  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.dons) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // A Connect id exists as soon as the Express account is created, before onboarding
  // actually finishes — checking only that would let a donor fill out the whole form
  // (amount, identity, SIRET for a company) and only discover payment isn't actually
  // available when they submit and hit the POST's own check below.
  let paymentEnabled = false
  if (assoc.stripeConnectId) {
    try {
      paymentEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      // This is just informational (drives whether the form renders enabled) — a
      // transient Stripe error here shouldn't 500 the whole public donation page.
      // The POST route re-checks for real before any money moves.
      console.error(`[public-don] failed to check payment availability for ${slug}:`, err)
    }
  }

  return NextResponse.json({
    name:                assoc.name,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
    paymentEnabled,
  })
}

const schema = z.object({
  donorType:   z.enum(["INDIVIDUAL", "COMPANY"]).optional().default("INDIVIDUAL"),
  firstName:   z.string().trim().min(1).max(100),
  lastName:    z.string().trim().min(1).max(100),
  companyName: z.string().trim().min(1).max(200).optional(),
  siret:       z.string().trim().regex(/^\d{14}$/, "SIRET invalide (14 chiffres)").optional(),
  email:       z.string().email().max(200),
  address:     z.string().trim().max(300).optional(),
  amount:      z.number().positive().max(100000),
  message:     z.string().trim().max(500).optional(),
  anonymous:   z.boolean().optional().default(false),
}).refine(
  d => d.donorType !== "COMPANY" || (!!d.companyName && !!d.siret),
  { message: "Nom de l'entreprise et SIRET requis pour un don d'entreprise", path: ["companyName"] },
).refine(
  d => d.donorType !== "COMPANY" || !d.siret || isValidSiret(d.siret),
  { message: "Numéro de SIRET invalide", path: ["siret"] },
)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!rateLimit(`don:${requestIp(req)}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      id:             true,
      name:           true,
      slug:           true,
      stripeConnectId: true,
      modules:        true,
      canIssueTaxReceipts: true,
    },
  })

  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.dons) return NextResponse.json({ error: "Module dons désactivé" }, { status: 403 })

  if (!assoc.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible" }, { status: 400 })
  if (!(await connectAccountChargesEnabled(assoc.stripeConnectId)))
    return NextResponse.json({ error: "Paiement en ligne non disponible" }, { status: 400 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { donorType, firstName, lastName, companyName, siret, email, address, amount, message, anonymous } = parsed.data

  const don = await prisma.don.create({
    data: {
      associationId: assoc.id,
      donorType,
      firstName,
      lastName,
      companyName: donorType === "COMPANY" ? companyName : null,
      siret:       donorType === "COMPANY" ? siret : null,
      email,
      address:   address || null,
      amount,
      message:   message || null,
      anonymous,
    },
  })

  const amountCents    = Math.round(amount * 100)
  const applicationFee = Math.round(amountCents * PLATFORM_FEE)

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: `Don à ${assoc.name}` },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: assoc.stripeConnectId },
      metadata:               { donId: don.id, associationId: assoc.id },
    },
    metadata:    { donId: don.id },
    success_url: `${APP_URL}/portal/${slug}/don?payment=success`,
    cancel_url:  `${APP_URL}/portal/${slug}/don?payment=cancelled`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

  await prisma.don.update({
    where: { id: don.id },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url })
}

import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { withPortalAuth } from "@/lib/api-wrapper"

const PLATFORM_FEE = 0.015

export const POST = withPortalAuth(async (req, ctx) => {
  const { cotisationId } = await req.json()
  if (!cotisationId) return NextResponse.json({ error: "cotisationId requis" }, { status: 422 })

  const cotisation = await prisma.cotisation.findFirst({
    where: { id: cotisationId, membreId: ctx.membreId!, status: "EN_ATTENTE" },
    include: { association: { select: { stripeConnectId: true, name: true, slug: true } } },
  })
  if (!cotisation)
    return NextResponse.json({ error: "Cotisation introuvable ou déjà réglée" }, { status: 404 })

  if (!cotisation.association.stripeConnectId || !cotisation.association.slug)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const amountCents     = Math.round(Number(cotisation.amount) * 100)
  const applicationFee  = Math.round(amountCents * PLATFORM_FEE)
  const slug            = cotisation.association.slug

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: {
            name: `${cotisation.association.name} — Cotisation ${cotisation.year}`,
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

  return NextResponse.json({ url: checkoutSession.url })
}, { module: "cotisations" })

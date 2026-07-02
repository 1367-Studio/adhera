import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const PLATFORM_FEE = 0.015
const MAX_QUANTITY  = 10

type Params = { id: string }

export const POST = withPortalAuth<Params>(async (req, ctx, { id: evenementId }) => {
  const body     = await req.json().catch(() => ({})) as { quantity?: number }
  const quantity = Math.max(1, Math.min(MAX_QUANTITY, Number(body?.quantity) || 1))

  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId: ctx.associationId },
    include: { association: { select: { stripeConnectId: true, name: true, slug: true } } },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })
  if (evenement.price == null || Number(evenement.price) === 0)
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })
  if (!evenement.association.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const connectAccount = await stripe.accounts.retrieve(evenement.association.stripeConnectId)
  if (!connectAccount.charges_enabled)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const existing = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId: ctx.membreId!, evenementId } },
    select: { ticketPaidAt: true },
  })
  if (existing?.ticketPaidAt)
    return NextResponse.json({ error: "Billet déjà acheté" }, { status: 422 })

  if (evenement.capacity != null) {
    const { _sum } = await prisma.participation.aggregate({
      where: {
        evenementId,
        membreId: { not: ctx.membreId! },
        OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
      },
      _sum: { quantity: true },
    })
    const usedSlots = _sum.quantity ?? 0
    if (usedSlots + quantity > evenement.capacity)
      return NextResponse.json({ error: "Événement complet" }, { status: 422 })
  }

  // Hold the slot(s) immediately so simultaneous requests can't oversell
  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId: ctx.membreId!, evenementId } },
    create: { membreId: ctx.membreId!, evenementId, rsvp: "CONFIRME", quantity },
    update: { rsvp: "CONFIRME", quantity },
    select: { id: true },
  })

  // Re-verify capacity after upsert to handle race conditions
  if (evenement.capacity != null) {
    const { _sum: postCheck } = await prisma.participation.aggregate({
      where: {
        evenementId,
        OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
      },
      _sum: { quantity: true },
    })
    if ((postCheck.quantity ?? 0) > evenement.capacity) {
      await prisma.participation.update({
        where: { id: participation.id },
        data:  { rsvp: null, quantity: 1 },
      })
      return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    }
  }

  const amountCents    = Math.round(Number(evenement.price) * 100)
  const totalCents     = amountCents * quantity
  const applicationFee = Math.round(totalCents * PLATFORM_FEE)
  const slug           = evenement.association.slug

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: `${evenement.association.name} — ${evenement.title}` },
        },
        quantity,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: evenement.association.stripeConnectId },
      metadata:               { participationId: participation.id, associationId: ctx.associationId },
    },
    metadata:    { participationId: participation.id },
    success_url: `${APP_URL}/portal/${slug}/evenements?ticket=success&eid=${evenementId}`,
    cancel_url:  `${APP_URL}/portal/${slug}/evenements?ticket=cancelled&eid=${evenementId}`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "TICKET_CHECKOUT_STARTED",
    entity:        "Participation",
    entityId:      participation.id,
    label:         evenement.title,
    metadata:      { quantity, amount: Number(evenement.price) * quantity },
  })

  return NextResponse.json({ url: checkoutSession.url })
}, { module: "evenements" })

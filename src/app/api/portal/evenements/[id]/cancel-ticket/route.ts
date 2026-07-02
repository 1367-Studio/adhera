import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

export const POST = withPortalAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId, userId, membreId } = ctx

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { title: true, date: true, price: true, associationId: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Impossible d'annuler un billet pour un événement déjà passé." }, { status: 422 })

  const participation = await prisma.participation.findUnique({
    where: { membreId_evenementId: { membreId: membreId!, evenementId } },
  })
  if (!participation?.ticketPaidAt)
    return NextResponse.json({ error: "Aucun billet payé pour cet événement." }, { status: 404 })
  if (!participation.stripeSessionId)
    return NextResponse.json({ error: "Ce billet a été réglé hors ligne — contactez l'association pour l'annuler." }, { status: 422 })

  const checkoutSession = await stripe.checkout.sessions.retrieve(participation.stripeSessionId)
  const paymentIntentId = typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id
  if (!paymentIntentId)
    return NextResponse.json({ error: "Paiement introuvable côté Stripe." }, { status: 422 })

  await stripe.refunds.create({
    payment_intent:         paymentIntentId,
    reverse_transfer:       true,
    refund_application_fee: true,
  })

  await prisma.$transaction([
    prisma.participation.update({
      where: { id: participation.id },
      data:  { ticketPaidAt: null, stripeSessionId: null, paidQuantity: null, rsvp: null, quantity: 1 },
    }),
    prisma.income.deleteMany({
      where: {
        associationId: evenement.associationId,
        memberId:      membreId!,
        description:   `Billet (Stripe) — ${evenement.title}`,
      },
    }),
  ])

  await writeActivityLog({
    associationId,
    actorId:       userId,
    action:        "TICKET_REFUNDED",
    entity:        "Participation",
    entityId:      participation.id,
    label:         evenement.title,
  })

  return NextResponse.json({ ok: true })
}, { module: "evenements" })

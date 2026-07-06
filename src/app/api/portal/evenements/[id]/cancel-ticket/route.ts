import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const bodySchema = z.object({ participationId: z.string().optional() })

export const POST = withPortalAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, userId, membreId } = ctx

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { title: true, date: true, price: true, associationId: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Impossible d'annuler un billet pour un événement déjà passé." }, { status: 422 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const selfTicket = await prisma.participation.findFirst({ where: { membreId: membreId!, evenementId } })
  if (!selfTicket)
    return NextResponse.json({ error: "Aucune réservation pour cet événement." }, { status: 404 })

  // One Stripe checkout can hold several seats (the member + named companions) sharing
  // the same orderId. Without a participationId, the whole order is cancelled; with one,
  // only that seat is refunded and released, the rest stay paid. Everything below reads
  // from `targets`, not `selfTicket`, on purpose — if the buyer already cancelled their
  // own seat in an earlier call, selfTicket.ticketPaidAt/stripeSessionId are already null,
  // but a companion seat can still be paid and cancellable.
  const orderWhere = selfTicket.orderId ? { orderId: selfTicket.orderId } : { id: selfTicket.id }
  const targets = await prisma.participation.findMany({
    where: {
      evenementId,
      ...orderWhere,
      ticketPaidAt: { not: null },
      ...(parsed.data.participationId ? { id: parsed.data.participationId } : {}),
    },
  })
  if (!targets.length)
    return NextResponse.json({ error: "Billet introuvable ou déjà annulé." }, { status: 404 })

  const stripeSessionId = targets.find(t => t.stripeSessionId)?.stripeSessionId
  if (!stripeSessionId)
    return NextResponse.json({ error: "Ce billet a été réglé hors ligne — contactez l'association pour l'annuler." }, { status: 422 })

  const checkoutSession = await stripe.checkout.sessions.retrieve(stripeSessionId)
  const paymentIntentId = typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id
  if (!paymentIntentId)
    return NextResponse.json({ error: "Paiement introuvable côté Stripe." }, { status: 422 })

  // Refund what was actually charged per seat (locked in on the participation row at
  // payment time), not the event's current price — an admin may have changed it since.
  const refundAmountCents = targets.reduce((sum, t) => sum + Math.round(Number(t.amount ?? evenement.price) * 100), 0)

  await stripe.refunds.create({
    payment_intent:         paymentIntentId,
    amount:                 refundAmountCents,
    reverse_transfer:       true,
    refund_application_fee: true,
  })

  const paidIncomes = await prisma.income.findMany({
    where:  { participationId: { in: targets.map(t => t.id) }, status: "PAID" },
    select: { id: true },
  })

  const selfTarget       = targets.find(t => t.membreId)
  const companionTargets = targets.filter(t => !t.membreId)

  await prisma.$transaction([
    // The buyer's own seat is reset (kept) so they can re-reserve later without hitting
    // the one-self-ticket-per-event constraint; a cancelled companion is just removed.
    ...(selfTarget ? [prisma.participation.update({
      where: { id: selfTarget.id },
      data:  { ticketPaidAt: null, stripeSessionId: null, amount: null, rsvp: null },
    })] : []),
    ...(companionTargets.length ? [prisma.participation.deleteMany({
      where: { id: { in: companionTargets.map(t => t.id) } },
    })] : []),
    prisma.income.deleteMany({ where: { id: { in: paidIncomes.map(i => i.id) } } }),
  ])

  await writeActivityLog({
    associationId,
    actorId:       userId,
    action:        "TICKET_REFUNDED",
    entity:        "Participation",
    entityId:      targets[0].id,
    label:         evenement.title,
    metadata:      { count: targets.length, partial: !!parsed.data.participationId },
  })

  return NextResponse.json({ ok: true })
}, { module: "evenements" })

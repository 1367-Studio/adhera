import { NextResponse } from "next/server"
import { z } from "zod"
import Stripe from "stripe"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const bodySchema = z.object({ participationId: z.string().optional() })

// Thrown (and caught) purely to force the claim transaction below to roll back —
// never actually surfaced past this file.
class TicketAlreadyClaimedError extends Error {}

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
  const targetIds = targets.map(t => t.id)

  // Claim these seats atomically before ever calling Stripe. A double-click or a second
  // tab hitting this endpoint for the same seats at the same time must not both reach
  // stripe.refunds.create — that would issue two real refunds for the same money. The
  // conditional updateMany only matches rows still paid; if a concurrent call already
  // claimed one of these seats, the count comes up short and the whole transaction is
  // thrown away (nothing gets written) instead of risking two payouts.
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.participation.updateMany({
        where: { id: { in: targetIds }, ticketPaidAt: { not: null } },
        data:  { ticketPaidAt: null, stripeSessionId: null, amount: null, rsvp: null },
      })
      if (count !== targetIds.length) throw new TicketAlreadyClaimedError()
    })
  } catch (err) {
    if (err instanceof TicketAlreadyClaimedError) {
      return NextResponse.json({ error: "Ce billet est déjà en cours d'annulation." }, { status: 409 })
    }
    throw err
  }

  try {
    await stripe.refunds.create({
      payment_intent:         paymentIntentId,
      amount:                 refundAmountCents,
      reverse_transfer:       true,
      refund_application_fee: true,
    }, {
      // Stable for this exact set of seats — safe to reuse on a network retry of this
      // same call (params never change once targetIds is fixed), so Stripe returns the
      // original refund instead of creating a second one.
      idempotencyKey: `ticket-refund-${targetIds.slice().sort().join("-")}`,
    })
  } catch (err) {
    // The claim above already committed — undo it so the seat doesn't sit "cancelled"
    // in the DB when no money actually moved.
    await prisma.$transaction(
      targets.map(t => prisma.participation.update({
        where: { id: t.id },
        data:  { ticketPaidAt: t.ticketPaidAt, stripeSessionId: t.stripeSessionId, amount: t.amount, rsvp: t.rsvp },
      }))
    )
    console.error(`[cancel-ticket] Stripe refund failed for seats ${targetIds.join(",")}:`, err)
    const message = err instanceof Stripe.errors.StripeError
      ? err.message
      : "Le remboursement a échoué. Réessayez dans quelques instants ou contactez l'association."
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const paidIncomes = await prisma.income.findMany({
    where:  { participationId: { in: targets.map(t => t.id) }, status: "PAID" },
    select: { id: true },
  })

  // Find linked bank transactions before deleting the reconciliation link, mirroring
  // what deleting an Income directly already does — otherwise a transaction reconciled
  // against one of these seats is left pointing at nothing, stuck at MATCHED forever.
  const reconciliations = paidIncomes.length
    ? await prisma.bankReconciliation.findMany({
        where:  { incomeId: { in: paidIncomes.map(i => i.id) } },
        select: { bankTransactionId: true },
      })
    : []
  const txIds = reconciliations.map(r => r.bankTransactionId)

  // The buyer's own seat was already reset (kept, not deleted) by the claim transaction
  // above, so they can re-reserve later without hitting the one-self-ticket-per-event
  // constraint — only a cancelled companion still needs removing here.
  const companionTargets = targets.filter(t => !t.membreId)

  await prisma.$transaction([
    ...(companionTargets.length ? [prisma.participation.deleteMany({
      where: { id: { in: companionTargets.map(t => t.id) } },
    })] : []),
    prisma.bankReconciliation.deleteMany({ where: { incomeId: { in: paidIncomes.map(i => i.id) } } }),
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" } })]
      : []),
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

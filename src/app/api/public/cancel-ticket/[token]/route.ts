import { NextResponse } from "next/server"
import Stripe from "stripe"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { sendEmail } from "@/lib/mail"
import { cancellationConfirmationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"

// Self-service cancellation for public/guest event registrations (no portal account, so
// the authenticated flow at src/app/api/portal/evenements/[id]/cancel-ticket/route.ts
// isn't reachable) — accessed via the unguessable cancelToken emailed at registration
// time, not a login. Always exactly one seat: the public form can now create several
// Participation rows sharing one orderId, but each row gets its own cancelToken so this
// route only ever needs to look up and refund/release the one seat that token belongs
// to — the other seats in the same order are untouched.

class TicketAlreadyClaimedError extends Error {}

async function findByToken(token: string) {
  return prisma.participation.findUnique({
    where:  { cancelToken: token },
    include: {
      evenement: {
        select: {
          title: true, date: true, price: true, associationId: true,
          association: { select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true } },
        },
      },
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Purely informational and gated by a 160-bit token already, but rate-limited anyway
  // for consistency with every other public endpoint in this app.
  if (!(await rateLimit(`cancel-ticket-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const participation = await findByToken(token)
  if (!participation) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  const cancelled = !participation.ticketPaidAt && !participation.rsvp

  return NextResponse.json({
    eventTitle: participation.evenement.title,
    eventDate:  participation.evenement.date,
    firstName:  participation.firstName,
    lastName:   participation.lastName,
    isPaid:     participation.ticketPaidAt != null,
    amount:     participation.amount?.toString() ?? null,
    cancelled,
    past:       participation.evenement.date < new Date(),
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!(await rateLimit(`cancel-ticket:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const participation = await findByToken(token)
  if (!participation) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (participation.evenement.date < new Date())
    return NextResponse.json({ error: "Cet événement est déjà passé." }, { status: 422 })
  if (!participation.ticketPaidAt && !participation.rsvp)
    return NextResponse.json({ error: "Cette inscription est déjà annulée." }, { status: 409 })

  const { associationId } = participation.evenement

  // Free registration — nothing to refund, just release the seat.
  if (!participation.ticketPaidAt) {
    await prisma.participation.update({
      where: { id: participation.id },
      data:  { rsvp: null },
    })
    await writeActivityLog({
      associationId, action: "PARTICIPATION_PUBLIC_CANCELLED", entity: "Participation", entityId: participation.id,
      label: `${participation.firstName} ${participation.lastName} — ${participation.evenement.title}`,
    })
    if (participation.email) {
      sendEmail(cancellationConfirmationEmail({
        firstName:       participation.firstName,
        email:           participation.email,
        associationName: participation.evenement.association.name,
        eventTitle:      participation.evenement.title,
        refunded:        false,
        branding:        resolveDocumentBranding(participation.evenement.association),
      }), { associationId, source: "PUBLIC_EVENT_CANCELLATION", sourceId: participation.id }).catch(() => {})
    }
    return NextResponse.json({ ok: true, refunded: false })
  }

  // Paid — needs a real Stripe refund. Offline (cash) tickets never reach this route since
  // only public-form registrations get a cancelToken, and that flow only ever pays by Stripe.
  if (!participation.stripeSessionId)
    return NextResponse.json({ error: "Billet réglé hors ligne — contactez l'association pour l'annuler." }, { status: 422 })

  const checkoutSession = await stripe.checkout.sessions.retrieve(participation.stripeSessionId)
  const paymentIntentId = typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id
  if (!paymentIntentId) return NextResponse.json({ error: "Paiement introuvable côté Stripe." }, { status: 422 })

  const refundAmountCents = Math.round(Number(participation.amount ?? participation.evenement.price) * 100)
  const savedState = { ticketPaidAt: participation.ticketPaidAt, stripeSessionId: participation.stripeSessionId, amount: participation.amount }

  // Claim atomically before ever calling Stripe — a double-click or two tabs must not both
  // reach stripe.refunds.create for the same seat. rsvp is deliberately left untouched here
  // (same reasoning as the portal route): clearing it now would free the seat for someone
  // else to book while the refund is still in flight, and a failed refund below would then
  // have silently un-booked this person for nothing.
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.participation.updateMany({
        where: { id: participation.id, ticketPaidAt: { not: null } },
        data:  { ticketPaidAt: null, stripeSessionId: null, amount: null },
      })
      if (count === 0) throw new TicketAlreadyClaimedError()
    })
  } catch (err) {
    if (err instanceof TicketAlreadyClaimedError) {
      return NextResponse.json({ error: "Cette annulation est déjà en cours." }, { status: 409 })
    }
    throw err
  }

  // A 0€ tier mixed into an otherwise-paid order (multiple ticket types, only some free)
  // still gets ticketPaidAt/stripeSessionId set on every seat once the order is paid — so
  // a free seat can reach this branch with nothing to actually refund. Stripe rejects a
  // refund of amount 0, and there's no money to move anyway, so just release the seat.
  if (refundAmountCents > 0) {
    try {
      await stripe.refunds.create({
        payment_intent:   paymentIntentId,
        amount:           refundAmountCents,
        reverse_transfer: true,
      }, {
        // Stable per participation — a network retry of this same call reaches the original
        // refund instead of creating a second one.
        idempotencyKey: `public-ticket-refund-${participation.id}`,
      })
    } catch (err) {
      // The claim above already committed — undo it so the seat doesn't sit "cancelled" in
      // the DB when no money actually moved.
      await prisma.participation.update({ where: { id: participation.id }, data: savedState })
      console.error(`[cancel-ticket] Stripe refund failed for participation ${participation.id}:`, err)
      const message = err instanceof Stripe.errors.StripeError
        ? err.message
        : "Le remboursement a échoué. Réessayez dans quelques instants ou contactez l'association."
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  const paidIncomes = await prisma.income.findMany({
    where:  { participationId: participation.id, status: "PAID" },
    select: { id: true },
  })
  const reconciliations = paidIncomes.length
    ? await prisma.bankReconciliation.findMany({
        where:  { incomeId: { in: paidIncomes.map(i => i.id) } },
        select: { bankTransactionId: true },
      })
    : []
  const txIds = reconciliations.map(r => r.bankTransactionId)

  await prisma.$transaction([
    prisma.participation.update({ where: { id: participation.id }, data: { rsvp: null } }),
    prisma.bankReconciliation.deleteMany({ where: { incomeId: { in: paidIncomes.map(i => i.id) } } }),
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" } })]
      : []),
    prisma.income.deleteMany({ where: { id: { in: paidIncomes.map(i => i.id) } } }),
  ])

  const refunded = refundAmountCents > 0

  await writeActivityLog({
    associationId, action: refunded ? "TICKET_REFUNDED" : "PARTICIPATION_PUBLIC_CANCELLED", entity: "Participation", entityId: participation.id,
    label: `${participation.firstName} ${participation.lastName} — ${participation.evenement.title}`,
  })

  if (participation.email) {
    sendEmail(cancellationConfirmationEmail({
      firstName:       participation.firstName,
      email:           participation.email,
      associationName: participation.evenement.association.name,
      eventTitle:      participation.evenement.title,
      refunded,
      amount:          refunded ? refundAmountCents / 100 : undefined,
      branding:        resolveDocumentBranding(participation.evenement.association),
    }), { associationId, source: "PUBLIC_EVENT_CANCELLATION", sourceId: participation.id }).catch(() => {})
  }

  return NextResponse.json({ ok: true, refunded })
}

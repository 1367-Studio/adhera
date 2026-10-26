import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { evenementHasFee, evenementTicketPaymentSelect } from "@/lib/evenement-ticket-payment"
import {
  buildBilanParticipantRows,
  euroAmountToCents,
  summarizeBilanParticipantRows,
  ticketIncomeWhere,
  type EvenementBilanParticipantsResponse,
} from "@/lib/evenement-bilan"

// Rows of the full bilan page (/dashboard/evenements/[id]/bilan): one per seat the bilan tiles
// count, with its net amount, payment status and review — see buildBilanParticipantRows for
// the row-set and payment rules. Kept separate from GET ../bilan so the events list's inline
// panel stays a light, counts-only request. Amounts are integer cents.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { id: true, slug: true, title: true, date: true, status: true, price: true, ticketTypes: evenementTicketPaymentSelect.ticketTypes },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const [participations, ticketIncomes, reviews] = await Promise.all([
    prisma.participation.findMany({
      where:  { evenementId },
      select: {
        id: true, firstName: true, lastName: true, email: true, present: true, rsvp: true,
        ticketPaidAt: true, amount: true, paymentMethod: true,
      },
    }),
    prisma.income.findMany({
      where:  ticketIncomeWhere(associationId, evenementId),
      select: { participationId: true, amount: true, status: true },
    }),
    prisma.evenementAvis.findMany({
      where:  { evenementId },
      select: { id: true, participationId: true, rating: true, comment: true },
    }),
  ])

  const participants = buildBilanParticipantRows({
    seats: participations.map(participation => ({
      id:            participation.id,
      firstName:     participation.firstName,
      lastName:      participation.lastName,
      email:         participation.email,
      present:       participation.present,
      rsvp:          participation.rsvp,
      isPaid:        participation.ticketPaidAt != null,
      amountCents:   euroAmountToCents(participation.amount),
      paymentMethod: participation.paymentMethod,
    })),
    ticketIncomes: ticketIncomes.map(ticketIncome => ({
      participationId: ticketIncome.participationId!,
      amountCents:     euroAmountToCents(ticketIncome.amount),
      status:          ticketIncome.status,
    })),
    reviews,
    evenementHasFee: evenementHasFee(evenement),
  })

  const seatIds = new Set(participations.map(participation => participation.id))
  const response: EvenementBilanParticipantsResponse = {
    evenement: {
      id:     evenement.id,
      slug:   evenement.slug,
      title:  evenement.title,
      date:   evenement.date.toISOString(),
      status: evenement.status,
    },
    participants,
    totals: summarizeBilanParticipantRows(participants),
    unattributedReviewCount: reviews.filter(review => !seatIds.has(review.participationId)).length,
  }
  return NextResponse.json(response)
}, { area: "evenements", module: "evenements" })

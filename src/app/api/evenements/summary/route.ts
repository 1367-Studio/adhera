import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveCurrentPeriod, exclusiveEndOfDay } from "@/lib/finance/exercice"
import {
  collectedTicketRevenueCents,
  euroAmountToCents,
  presentParticipationWhere,
  registeredParticipationWhere,
  type EvenementsSummary,
} from "@/lib/evenement-bilan"

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx
  const period = await resolveCurrentPeriod(associationId)
  const dateInPeriod = { gte: period.startDate, lt: exclusiveEndOfDay(period.endDate) }

  // Only DRAFT is excluded — the schema has no "cancelled" status, and ARCHIVED (see
  // Evenement.status's comment) means "retired from the public site, history kept", not
  // "didn't happen": an event archived after the fact should still count here, same as its
  // own bilan page still shows its figures. Excluding it would also contradict revenueCents
  // below, which is never gated by event status — an archived event's past ticket payments
  // would then count towards "Revenus encaissés" while the event itself vanished from
  // "Nombre d'événements" and its seats from "Participants".
  const consideredEvenementWhere = { associationId, status: { not: "DRAFT" as const }, date: dateInPeriod }

  const [
    eventCount, registeredCount, presentCount, reviewAggregate,
    paidParticipations, ticketIncomes,
  ] = await Promise.all([
    prisma.evenement.count({ where: consideredEvenementWhere }),
    prisma.participation.count({ where: { ...registeredParticipationWhere, evenement: consideredEvenementWhere } }),
    prisma.participation.count({ where: { ...presentParticipationWhere, evenement: consideredEvenementWhere } }),
    prisma.evenementAvis.aggregate({
      where:  { participation: { evenement: consideredEvenementWhere } },
      _avg:   { rating: true },
      _count: { _all: true },
    }),
    // Revenue follows the payment's receipt date, not the event date — a ticket for an event
    // outside the period but paid during it (or vice versa) is counted by when the money moved,
    // same convention as Dons/Boutique. Legacy fallback (seats paid before
    // Income.participationId existed, see revenueCentsBySeat) uses ticketPaidAt as its receipt
    // date since it has no linked Income row to read one from.
    prisma.participation.findMany({
      where:  { evenement: { associationId }, ticketPaidAt: dateInPeriod },
      select: { id: true, amount: true },
    }),
    prisma.income.findMany({
      where:  { associationId, commandeId: null, participationId: { not: null }, date: dateInPeriod },
      select: { participationId: true, amount: true, status: true },
    }),
  ])

  const revenueCents = collectedTicketRevenueCents(
    paidParticipations.map(participation => ({ id: participation.id, amountCents: euroAmountToCents(participation.amount) })),
    ticketIncomes.map(ticketIncome => ({
      participationId: ticketIncome.participationId!,
      amountCents:     euroAmountToCents(ticketIncome.amount),
      status:          ticketIncome.status,
    })),
  )

  const summary: EvenementsSummary = {
    period:          { kind: period.kind, startYear: period.startYear, endYear: period.endYear },
    eventCount,
    registeredCount,
    presentCount,
    revenueCents,
    reviewCount:   reviewAggregate._count._all,
    averageRating: reviewAggregate._avg.rating,
  }
  return NextResponse.json(summary)
}, { area: "evenements", module: "evenements" })

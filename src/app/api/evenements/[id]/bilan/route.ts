import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import {
  collectedTicketRevenueCents,
  euroAmountToCents,
  presentParticipationWhere,
  registeredParticipationWhere,
  type EvenementBilan,
} from "@/lib/evenement-bilan"

// Per-event summary ("bilan") for the inline panel of the dashboard events list, fetched only
// when a row is expanded. Every figure follows a rule the app already uses elsewhere, so the
// panel never disagrees with the table row above it:
// - registeredCount: seats paid or held as confirmed (ticketPaidAt set, or rsvp CONFIRME) —
//   the list's « réservés » rule. Waitlisted, declined and refunded seats are excluded.
// - presentCount: seats checked in (present) — the list's « présents » rule.
// - revenueCents: ticket money kept, net of refunds, in integer cents — see
//   collectedTicketRevenueCents for the exact rule. Boutique products and donations bought
//   alongside a ticket are not included: Finances books them as boutique / don revenue
//   (Income.commandeId / Don), not as event revenue.
// - averageRating / reviewCount: every EvenementAvis left for this event; averageRating is
//   null when there is none.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId }, select: { id: true } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const [registeredCount, presentCount, paidParticipations, ticketIncomes, reviewAggregate] = await Promise.all([
    prisma.participation.count({ where: { evenementId, ...registeredParticipationWhere } }),
    prisma.participation.count({ where: { evenementId, ...presentParticipationWhere } }),
    prisma.participation.findMany({
      where:  { evenementId, ticketPaidAt: { not: null } },
      select: { id: true, amount: true },
    }),
    prisma.income.findMany({
      where:  { associationId, commandeId: null, participation: { evenementId } },
      select: { participationId: true, amount: true, status: true },
    }),
    prisma.evenementAvis.aggregate({
      where:  { evenementId },
      _avg:   { rating: true },
      _count: { _all: true },
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

  const bilan: EvenementBilan = {
    registeredCount,
    presentCount,
    revenueCents,
    reviewCount:   reviewAggregate._count._all,
    averageRating: reviewAggregate._avg.rating,
  }
  return NextResponse.json(bilan)
}, { area: "evenements", module: "evenements" })

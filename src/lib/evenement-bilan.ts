import type { IncomeStatus, Prisma } from "@prisma/client"

// Per-event summary ("bilan") shown inline under a row of the dashboard events list — see
// GET /api/evenements/[id]/bilan. Money is in integer cents: Participation.amount and
// Income.amount are Decimal euros, and summing them as floats drifts (0.1 + 0.2), so every
// amount is rounded to cents once, on the way in.
export type EvenementBilan = {
  registeredCount: number
  presentCount:    number
  revenueCents:    number
  reviewCount:     number
  averageRating:   number | null
}

// Same rule as the events list's « réservés » (confirmedCount in GET /api/evenements) and the
// presences page's reservedCount: a seat that is paid, or held as confirmed. Waitlisted,
// declined and cancelled/refunded seats (every refund path clears ticketPaidAt and rsvp)
// never match.
export const registeredParticipationWhere = {
  OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
} satisfies Prisma.ParticipationWhereInput

// Same rule as the events list's « présents » (_count.participations in GET /api/evenements):
// checked in at the door, by hand or via the ticket scanner.
export const presentParticipationWhere = { present: true } satisfies Prisma.ParticipationWhereInput

export function euroAmountToCents(amount: number | string | { toString(): string } | null | undefined): number {
  if (amount == null) return 0
  return Math.round(Number(amount.toString()) * 100)
}

export type PaidParticipationForRevenue = {
  id:          string
  amountCents: number
}

export type TicketIncomeForRevenue = {
  participationId: string
  amountCents:     number
  status:          IncomeStatus
}

// Ticket money actually kept for an event, net of refunds. The Income ledger is the source of
// truth because every refund path adjusts it: an in-app cancellation (portal cancel-ticket,
// admin cancel-payment) deletes the seat's Income rows, a full Stripe refund marks them
// CANCELLED, and a partial Stripe refund lowers their amount — so a seat that has ticket
// Income rows counts the sum of its PAID ones. A seat paid before Income.participationId
// existed (2026-07-06) has no linked row at all; for those only, the amount locked on the
// participation at payment time is used, and only while it is still paid (a refund clears
// ticketPaidAt and amount).
// Callers pass ticket Income rows only: rows also carrying a commandeId are boutique sales
// bought alongside the ticket, which Finances books as boutique revenue, not event revenue.
export function collectedTicketRevenueCents(
  paidParticipations: PaidParticipationForRevenue[],
  ticketIncomes:      TicketIncomeForRevenue[],
): number {
  const participationIdsWithIncome = new Set(ticketIncomes.map(ticketIncome => ticketIncome.participationId))

  const ledgerCents = ticketIncomes
    .filter(ticketIncome => ticketIncome.status === "PAID")
    .reduce((total, ticketIncome) => total + ticketIncome.amountCents, 0)

  const legacyCents = paidParticipations
    .filter(participation => !participationIdsWithIncome.has(participation.id))
    .reduce((total, participation) => total + participation.amountCents, 0)

  return ledgerCents + legacyCents
}

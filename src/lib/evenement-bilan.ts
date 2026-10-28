import type { EvenementPaymentMethod, IncomeStatus, Prisma, RsvpStatus } from "@prisma/client"

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

// The 4 KPI cards on top of the dashboard events list (GET /api/evenements/summary) — same
// shape as EvenementBilan plus eventCount and the resolved period, since it summarizes every
// considered event at once instead of one.
export type EvenementsSummary = EvenementBilan & {
  period:     { kind: "exercice" | "calendar"; startYear: number; endYear: number }
  eventCount: number
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

// Ticket Income rows of an event — rows also carrying a commandeId are boutique sales bought
// alongside the ticket, which Finances books as boutique revenue, not event revenue. Shared by
// the bilan tiles and the bilan participants table so both read exactly the same rows.
export function ticketIncomeWhere(associationId: string, evenementId: string) {
  return { associationId, commandeId: null, participation: { evenementId } } satisfies Prisma.IncomeWhereInput
}

// Ticket money actually kept per seat, net of refunds. The Income ledger is the source of
// truth because every refund path adjusts it: an in-app cancellation (portal cancel-ticket,
// admin cancel-payment) deletes the seat's Income rows, a full Stripe refund marks them
// CANCELLED, and a partial Stripe refund lowers their amount — so a seat that has ticket
// Income rows counts the sum of its PAID ones (0 once fully refunded). A seat paid before
// Income.participationId existed (2026-07-06) has no linked row at all; for those only, the
// amount locked on the participation at payment time is used, and only while it is still paid
// (a refund clears ticketPaidAt and amount). Seats with neither are absent from the map: no
// money ever moved for them.
export function revenueCentsBySeat(
  paidParticipations: PaidParticipationForRevenue[],
  ticketIncomes:      TicketIncomeForRevenue[],
): Map<string, number> {
  const revenueBySeat = new Map<string, number>()
  for (const ticketIncome of ticketIncomes) {
    const paidCents = ticketIncome.status === "PAID" ? ticketIncome.amountCents : 0
    revenueBySeat.set(ticketIncome.participationId, (revenueBySeat.get(ticketIncome.participationId) ?? 0) + paidCents)
  }
  for (const participation of paidParticipations) {
    if (!revenueBySeat.has(participation.id)) revenueBySeat.set(participation.id, participation.amountCents)
  }
  return revenueBySeat
}

// The « Revenus encaissés » tile: the sum of revenueCentsBySeat, so the bilan table's
// « Montant payé » column always adds up to it.
export function collectedTicketRevenueCents(
  paidParticipations: PaidParticipationForRevenue[],
  ticketIncomes:      TicketIncomeForRevenue[],
): number {
  let totalCents = 0
  for (const seatCents of revenueCentsBySeat(paidParticipations, ticketIncomes).values()) totalCents += seatCents
  return totalCents
}

// ── Bilan participants table (/dashboard/evenements/[id]/bilan) ─────────────────────────

export type BilanPaymentStatus = "PAID" | "PENDING" | "REFUNDED" | "FREE"

export type BilanSeat = {
  id:            string
  firstName:     string
  lastName:      string
  email:         string | null
  present:       boolean
  rsvp:          RsvpStatus | null
  isPaid:        boolean // ticketPaidAt set
  amountCents:   number  // Participation.amount: the price locked in at payment, 0 when unset
  paymentMethod: EvenementPaymentMethod | null
}

export type BilanReview = {
  id:              string
  participationId: string
  rating:          number
  comment:         string | null
}

export type BilanParticipantRow = {
  id:            string
  firstName:     string
  lastName:      string
  email:         string | null
  present:       boolean
  // null = no money ever moved for this seat (free, or not paid yet) — shown as « — ».
  collectedCents: number | null
  paymentStatus: BilanPaymentStatus
  paymentMethod: EvenementPaymentMethod | null
  review:        { id: string; rating: number; comment: string | null } | null
}

export type BilanParticipantsTotals = {
  participantCount: number
  presentCount:     number
  revenueCents:     number
  reviewCount:      number
}

export type EvenementBilanParticipantsResponse = {
  evenement: {
    id:     string
    slug:   string | null
    title:  string
    date:   string
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  }
  participants: BilanParticipantRow[]
  totals:       BilanParticipantsTotals
  // Reviews whose seat isn't one of this event's participations — EvenementAvis always points
  // at a participation (participationId is required), so this stays 0 unless the data is
  // inconsistent. Still counted in the « Avis » tile, which aggregates by evenementId.
  unattributedReviewCount: number
}

// Same rule as registeredParticipationWhere, for rows already loaded in memory.
export function isRegisteredSeat(seat: Pick<BilanSeat, "isPaid" | "rsvp">): boolean {
  return seat.isPaid || seat.rsvp === "CONFIRME"
}

function paymentStatusOf(seat: BilanSeat, hasLedgerRows: boolean, evenementHasFee: boolean): BilanPaymentStatus {
  // A paid seat at 0 € is the « Marquer gratuit » exemption or a 0 € tarif — never « Payé »,
  // same rule as the presences page and its export.
  if (seat.isPaid) return seat.amountCents > 0 ? "PAID" : "FREE"
  // No longer paid but ticket Income rows remain (soft-cancelled by a full Stripe refund).
  if (hasLedgerRows) return "REFUNDED"
  return evenementHasFee ? "PENDING" : "FREE"
}

// One row per seat the bilan tiles count: inscrits (registered rule) ∪ présents, plus — so the
// table always reconciles with the tiles — any other seat still carrying ticket revenue or a
// review (normally none: a review needs a check-in, a paid seat is registered). Sorted by
// last name then first name, like the presences list.
export function buildBilanParticipantRows(params: {
  seats:           BilanSeat[]
  ticketIncomes:   TicketIncomeForRevenue[]
  reviews:         BilanReview[]
  evenementHasFee: boolean
}): BilanParticipantRow[] {
  const { seats, ticketIncomes, reviews, evenementHasFee } = params
  const revenueBySeat = revenueCentsBySeat(
    seats.filter(seat => seat.isPaid).map(seat => ({ id: seat.id, amountCents: seat.amountCents })),
    ticketIncomes,
  )
  const seatIdsWithLedgerRows = new Set(ticketIncomes.map(ticketIncome => ticketIncome.participationId))
  const reviewBySeat = new Map(reviews.map(review => [review.participationId, review]))

  return seats
    .filter(seat => isRegisteredSeat(seat) || seat.present || (revenueBySeat.get(seat.id) ?? 0) !== 0 || reviewBySeat.has(seat.id))
    .map(seat => {
      const review = reviewBySeat.get(seat.id)
      const paymentStatus = paymentStatusOf(seat, seatIdsWithLedgerRows.has(seat.id), evenementHasFee)
      return {
        id:             seat.id,
        firstName:      seat.firstName,
        lastName:       seat.lastName,
        email:          seat.email,
        present:        seat.present,
        collectedCents: revenueBySeat.get(seat.id) ?? null,
        paymentStatus,
        // Null on a paid seat means Stripe (every row before Participation.paymentMethod
        // existed) — see the schema. A pending seat keeps the offline method chosen at
        // registration, if any. Free and refunded seats show none.
        paymentMethod:  paymentStatus === "PAID" ? (seat.paymentMethod ?? "STRIPE") : paymentStatus === "PENDING" ? seat.paymentMethod : null,
        review:         review ? { id: review.id, rating: review.rating, comment: review.comment } : null,
      }
    })
    .sort((first, second) =>
      first.lastName.localeCompare(second.lastName, "fr", { sensitivity: "base" })
      || first.firstName.localeCompare(second.firstName, "fr", { sensitivity: "base" }))
}

// Whole-event totals of the table (never the filtered view) — equal to the tiles' présents,
// revenus and avis by construction, see buildBilanParticipantRows.
export function summarizeBilanParticipantRows(rows: BilanParticipantRow[]): BilanParticipantsTotals {
  return {
    participantCount: rows.length,
    presentCount:     rows.filter(row => row.present).length,
    revenueCents:     rows.reduce((total, row) => total + (row.collectedCents ?? 0), 0),
    reviewCount:      rows.filter(row => row.review).length,
  }
}

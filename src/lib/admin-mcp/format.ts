// Pure helpers for the admin MCP tools (no Prisma, no Stripe) so they can be unit-tested.

export const DAY_MS = 24 * 60 * 60 * 1000

export function centsToEuros(amountCents: number): number {
  return Math.round(amountCents) / 100
}

// Prisma Decimal / number / null → euros as a plain number rounded to the cent.
export function decimalToEuros(decimalValue: { toString(): string } | number | null | undefined): number {
  if (decimalValue === null || decimalValue === undefined) return 0
  const numericValue = typeof decimalValue === "number" ? decimalValue : Number(decimalValue.toString())
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0
}

export function toIsoOrNull(dateValue: Date | null | undefined): string | null {
  return dateValue ? dateValue.toISOString() : null
}

// Whole days until `target`, rounded up (a trial ending in 3h still has "1 day left");
// negative once the date has passed.
export function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS)
}

export function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

// Same rule as deriveTicketUnread(ticket, "STAFF") in src/lib/support-tickets.ts — restated
// here rather than imported because that module also pulls in the Resend/Pusher clients,
// and this read-only endpoint should not even load code capable of sending anything.
// Covered by format.test.ts; keep the two in sync.
export function isTicketUnreadForStaff(ticket: {
  lastMessageAt:         Date
  lastMessageAuthorRole: string
  readByStaffAt:         Date | null
}): boolean {
  if (ticket.lastMessageAuthorRole !== "ADMIN") return false
  return !ticket.readByStaffAt || ticket.readByStaffAt < ticket.lastMessageAt
}

// Every tool answers with one compact JSON text block — Claude reads it, no prose needed.
export function jsonToolResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] }
}

// ---------------------------------------------------------------------------------------
// MRR
//
// There is no MRR computation anywhere else in the app: the backoffice "faturamento" chart
// reports Stripe *net cash* per month (balance transactions, incl. Connect commissions),
// which is revenue, not recurring subscription value. MRR here is derived from DB fields
// kept in sync by the Stripe webhook (subscriptionStatus, subscriptionAmountCents,
// currentPeriodEndsAt) using the same notion of "paying" as platformFeeRate() in
// src/lib/stripe.ts: ACTIVE with a non-zero subscription amount.
//
// subscriptionAmountCents is the raw Stripe price unit_amount, so a yearly price must be
// spread over 12 months and a PricingOffer phase billed once per N months over N months.
// The DB stores no billing interval, so the interval is inferred:
//   1. PricingOffer phase with the same amount → that phase's `months` (null = monthly).
//   2. Amount equals a catalog yearly price (getPricingInfo) → yearly.
//   3. Current period ends more than YEARLY_PERIOD_THRESHOLD_DAYS from now → yearly
//      (covers legacy yearly prices not in the current catalog).
//   4. Otherwise monthly.
// ---------------------------------------------------------------------------------------

export const YEARLY_PERIOD_THRESHOLD_DAYS = 45

export type OfferPhaseInput = { amountCents: number; months: number | null }

export type MrrInputRow = {
  subscriptionStatus:      string
  subscriptionAmountCents: number | null
  currentPeriodEndsAt:     Date | null
  offerPhases:             OfferPhaseInput[] | null
}

export type BillingIntervalGuess = { months: number; source: "offer" | "catalog-yearly" | "period-length" | "default-monthly" }

export function guessBillingIntervalMonths(
  row: Pick<MrrInputRow, "subscriptionAmountCents" | "currentPeriodEndsAt" | "offerPhases">,
  yearlyCatalogAmountsCents: ReadonlySet<number> | null,
  now: Date,
): BillingIntervalGuess {
  const amountCents = row.subscriptionAmountCents ?? 0
  const matchingPhase = row.offerPhases?.find(phase => phase.amountCents === amountCents)
  if (matchingPhase) return { months: matchingPhase.months ?? 1, source: "offer" }
  if (yearlyCatalogAmountsCents?.has(amountCents)) return { months: 12, source: "catalog-yearly" }
  if (row.currentPeriodEndsAt && daysUntil(row.currentPeriodEndsAt, now) > YEARLY_PERIOD_THRESHOLD_DAYS) {
    return { months: 12, source: "period-length" }
  }
  return { months: 1, source: "default-monthly" }
}

export function monthlyRecurringCents(
  row: MrrInputRow,
  yearlyCatalogAmountsCents: ReadonlySet<number> | null,
  now: Date,
): number {
  const amountCents = row.subscriptionAmountCents ?? 0
  if (amountCents <= 0) return 0
  const interval = guessBillingIntervalMonths(row, yearlyCatalogAmountsCents, now)
  return amountCents / interval.months
}

export type MrrSummary = {
  mrrEuros:                    number
  arrEuros:                    number
  payingAssociations:          number
  multiMonthBilledAssociations: number
  activeFreeAssociations:      number
  activeAmountUnknown:         number
  pastDueMonthlyAtRiskEuros:   number
  pastDueAssociations:         number
  catalogPricesAvailable:      boolean
}

export function summarizeMrr(
  rows: readonly MrrInputRow[],
  yearlyCatalogAmountsCents: ReadonlySet<number> | null,
  now: Date,
): MrrSummary {
  let mrrCents = 0
  let payingAssociations = 0
  let multiMonthBilledAssociations = 0
  let activeFreeAssociations = 0
  let activeAmountUnknown = 0
  let pastDueCents = 0
  let pastDueAssociations = 0

  for (const row of rows) {
    if (row.subscriptionStatus === "ACTIVE") {
      if (row.subscriptionAmountCents === null) { activeAmountUnknown++; continue }
      if (row.subscriptionAmountCents === 0)    { activeFreeAssociations++; continue }
      payingAssociations++
      if (guessBillingIntervalMonths(row, yearlyCatalogAmountsCents, now).months > 1) multiMonthBilledAssociations++
      mrrCents += monthlyRecurringCents(row, yearlyCatalogAmountsCents, now)
    } else if (row.subscriptionStatus === "PAST_DUE") {
      pastDueAssociations++
      pastDueCents += monthlyRecurringCents(row, yearlyCatalogAmountsCents, now)
    }
  }

  return {
    mrrEuros:                  centsToEuros(mrrCents),
    arrEuros:                  centsToEuros(mrrCents * 12),
    payingAssociations,
    multiMonthBilledAssociations,
    activeFreeAssociations,
    activeAmountUnknown,
    pastDueMonthlyAtRiskEuros: centsToEuros(pastDueCents),
    pastDueAssociations,
    catalogPricesAvailable:    yearlyCatalogAmountsCents !== null,
  }
}

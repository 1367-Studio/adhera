import { describe, expect, it } from "vitest"
import {
  DAY_MS,
  daysUntil,
  decimalToEuros,
  guessBillingIntervalMonths,
  isTicketUnreadForStaff,
  summarizeMrr,
  type MrrInputRow,
} from "@/lib/admin-mcp/format"

const NOW = new Date("2026-11-04T10:00:00.000Z")
const YEARLY_CATALOG = new Set([35880, 59880])

function billingRow(overrides: Partial<MrrInputRow>): MrrInputRow {
  return {
    subscriptionStatus:      "ACTIVE",
    subscriptionAmountCents: 2990,
    currentPeriodEndsAt:     new Date(NOW.getTime() + 20 * DAY_MS),
    offerPhases:             null,
    ...overrides,
  }
}

describe("guessBillingIntervalMonths", () => {
  it("uses the matching pricing-offer phase length first", () => {
    const guess = guessBillingIntervalMonths(
      billingRow({ subscriptionAmountCents: 5000, offerPhases: [{ amountCents: 5000, months: 6 }, { amountCents: 2990, months: null }] }),
      YEARLY_CATALOG,
      NOW,
    )
    expect(guess).toEqual({ months: 6, source: "offer" })
  })

  it("treats an open-ended offer phase as monthly", () => {
    const guess = guessBillingIntervalMonths(
      billingRow({ subscriptionAmountCents: 2990, offerPhases: [{ amountCents: 2990, months: null }] }),
      YEARLY_CATALOG,
      NOW,
    )
    expect(guess.months).toBe(1)
  })

  it("recognizes a catalog yearly price", () => {
    expect(guessBillingIntervalMonths(billingRow({ subscriptionAmountCents: 35880 }), YEARLY_CATALOG, NOW).source).toBe("catalog-yearly")
  })

  it("falls back to the period length when catalog prices are unavailable", () => {
    const farPeriodEnd = new Date(NOW.getTime() + 200 * DAY_MS)
    expect(guessBillingIntervalMonths(billingRow({ subscriptionAmountCents: 35880, currentPeriodEndsAt: farPeriodEnd }), null, NOW))
      .toEqual({ months: 12, source: "period-length" })
    expect(guessBillingIntervalMonths(billingRow({}), null, NOW)).toEqual({ months: 1, source: "default-monthly" })
  })
})

describe("summarizeMrr", () => {
  it("sums paying ACTIVE subscriptions normalized to monthly and reports the rest separately", () => {
    const summary = summarizeMrr([
      billingRow({ subscriptionAmountCents: 2990 }),                       // monthly 29,90
      billingRow({ subscriptionAmountCents: 35880 }),                      // yearly 358,80 → 29,90
      billingRow({ subscriptionAmountCents: 0 }),                          // 0€ offer
      billingRow({ subscriptionAmountCents: null }),                       // not synced yet
      billingRow({ subscriptionStatus: "PAST_DUE", subscriptionAmountCents: 4990 }),
      billingRow({ subscriptionStatus: "TRIAL", subscriptionAmountCents: 4990 }),
    ], YEARLY_CATALOG, NOW)

    expect(summary).toEqual({
      mrrEuros:                     59.8,
      arrEuros:                     717.6,
      payingAssociations:           2,
      multiMonthBilledAssociations: 1,
      activeFreeAssociations:       1,
      activeAmountUnknown:          1,
      pastDueMonthlyAtRiskEuros:    49.9,
      pastDueAssociations:          1,
      catalogPricesAvailable:       true,
    })
  })

  it("returns zeros for no rows", () => {
    expect(summarizeMrr([], null, NOW).mrrEuros).toBe(0)
  })
})

describe("small formatters", () => {
  it("rounds days left up and goes negative once past", () => {
    expect(daysUntil(new Date(NOW.getTime() + 3 * 60 * 60 * 1000), NOW)).toBe(1)
    expect(daysUntil(new Date(NOW.getTime() + 7 * DAY_MS), NOW)).toBe(7)
    expect(daysUntil(new Date(NOW.getTime() - 2 * DAY_MS), NOW)).toBe(-2)
  })

  it("converts Decimal-like values to euros", () => {
    expect(decimalToEuros({ toString: () => "12.345" })).toBe(12.35)
    expect(decimalToEuros(null)).toBe(0)
    expect(decimalToEuros(7)).toBe(7)
  })

  it("flags a ticket unread for staff only when the association wrote last and staff hasn't read since", () => {
    const lastMessageAt = new Date("2026-11-03T10:00:00.000Z")
    expect(isTicketUnreadForStaff({ lastMessageAt, lastMessageAuthorRole: "ADMIN", readByStaffAt: null })).toBe(true)
    expect(isTicketUnreadForStaff({ lastMessageAt, lastMessageAuthorRole: "ADMIN", readByStaffAt: new Date("2026-11-02T10:00:00.000Z") })).toBe(true)
    expect(isTicketUnreadForStaff({ lastMessageAt, lastMessageAuthorRole: "ADMIN", readByStaffAt: new Date("2026-11-03T11:00:00.000Z") })).toBe(false)
    expect(isTicketUnreadForStaff({ lastMessageAt, lastMessageAuthorRole: "SUPER_ADMIN", readByStaffAt: null })).toBe(false)
  })
})

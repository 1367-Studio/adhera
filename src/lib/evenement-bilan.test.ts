import { describe, expect, it } from "vitest"
import { collectedTicketRevenueCents, euroAmountToCents } from "@/lib/evenement-bilan"

describe("euroAmountToCents", () => {
  it("rounds Decimal-like euro amounts to integer cents", () => {
    expect(euroAmountToCents("12.30")).toBe(1230)
    expect(euroAmountToCents(0.1 + 0.2)).toBe(30)
    expect(euroAmountToCents({ toString: () => "7.5" })).toBe(750)
  })

  it("treats a missing amount as zero", () => {
    expect(euroAmountToCents(null)).toBe(0)
    expect(euroAmountToCents(undefined)).toBe(0)
  })
})

describe("collectedTicketRevenueCents", () => {
  it("sums the PAID ticket income rows", () => {
    expect(collectedTicketRevenueCents(
      [{ id: "seat-a", amountCents: 1500 }, { id: "seat-b", amountCents: 1000 }],
      [
        { participationId: "seat-a", amountCents: 1500, status: "PAID" },
        { participationId: "seat-b", amountCents: 1000, status: "PAID" },
      ],
    )).toBe(2500)
  })

  it("leaves out a fully refunded seat (income CANCELLED, seat no longer paid)", () => {
    expect(collectedTicketRevenueCents(
      [{ id: "seat-a", amountCents: 1500 }],
      [
        { participationId: "seat-a", amountCents: 1500, status: "PAID" },
        { participationId: "seat-b", amountCents: 1000, status: "CANCELLED" },
      ],
    )).toBe(1500)
  })

  it("uses the reduced income amount after a partial refund, not the seat's original price", () => {
    expect(collectedTicketRevenueCents(
      [{ id: "seat-a", amountCents: 2000 }],
      [{ participationId: "seat-a", amountCents: 1200, status: "PAID" }],
    )).toBe(1200)
  })

  it("falls back to the seat amount only for a paid seat with no linked income row (legacy)", () => {
    expect(collectedTicketRevenueCents(
      [{ id: "legacy-seat", amountCents: 800 }, { id: "seat-a", amountCents: 1500 }],
      [{ participationId: "seat-a", amountCents: 1500, status: "PAID" }],
    )).toBe(2300)
  })

  it("never falls back to the seat amount when its income rows were cancelled", () => {
    expect(collectedTicketRevenueCents(
      [{ id: "seat-a", amountCents: 1500 }],
      [{ participationId: "seat-a", amountCents: 1500, status: "CANCELLED" }],
    )).toBe(0)
  })

  it("is zero for an event with no paid seat", () => {
    expect(collectedTicketRevenueCents([], [])).toBe(0)
  })
})

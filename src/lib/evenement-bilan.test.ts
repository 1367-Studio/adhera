import { describe, expect, it } from "vitest"
import {
  buildBilanParticipantRows,
  collectedTicketRevenueCents,
  euroAmountToCents,
  isRegisteredSeat,
  summarizeBilanParticipantRows,
  type BilanReview,
  type BilanSeat,
  type TicketIncomeForRevenue,
} from "@/lib/evenement-bilan"

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

function seat(overrides: Partial<BilanSeat> & Pick<BilanSeat, "id" | "lastName">): BilanSeat {
  return {
    firstName: "Alex", email: null, present: false, rsvp: null, isPaid: false, amountCents: 0, paymentMethod: null,
    ...overrides,
  }
}

// One event exercising every case at once: a Stripe seat, a cash seat partially refunded, a
// legacy seat with no Income link, a fully refunded seat that still came, a reserved-unpaid
// seat, a 0 € exemption, a walk-in, and seats that must stay out (waitlist, declined).
const seats: BilanSeat[] = [
  seat({ id: "stripe",   lastName: "Martin",  isPaid: true, amountCents: 1500, present: true, rsvp: "CONFIRME" }),
  seat({ id: "cash",     lastName: "Bernard", isPaid: true, amountCents: 2000, paymentMethod: "ESPECES", rsvp: "CONFIRME" }),
  seat({ id: "legacy",   lastName: "Durand",  isPaid: true, amountCents: 800 }),
  seat({ id: "refunded", lastName: "Petit",   present: true }),
  seat({ id: "reserved", lastName: "Leroy",   rsvp: "CONFIRME", paymentMethod: "VIREMENT" }),
  seat({ id: "exempt",   lastName: "Moreau",  isPaid: true, amountCents: 0, present: true }),
  seat({ id: "walkin",   lastName: "Fournier", present: true }),
  seat({ id: "waitlist", lastName: "Girard",  rsvp: "LISTA_ESPERA" }),
  seat({ id: "declined", lastName: "Roux",    rsvp: "ABSENT" }),
]
const ticketIncomes: TicketIncomeForRevenue[] = [
  { participationId: "stripe",   amountCents: 1500, status: "PAID" },
  { participationId: "cash",     amountCents: 1200, status: "PAID" },
  { participationId: "refunded", amountCents: 1500, status: "CANCELLED" },
]
const reviews: BilanReview[] = [
  { id: "review-1", participationId: "stripe", rating: 5, comment: "Super" },
  { id: "review-2", participationId: "walkin", rating: 4, comment: null },
]

describe("buildBilanParticipantRows", () => {
  const rows = buildBilanParticipantRows({ seats, ticketIncomes, reviews, evenementHasFee: true })
  const rowById = new Map(rows.map(row => [row.id, row]))

  it("lists inscrits and présents, never waitlisted or declined seats", () => {
    expect(rows.map(row => row.id).sort()).toEqual(["cash", "exempt", "legacy", "refunded", "reserved", "stripe", "walkin"])
  })

  it("sorts by last name", () => {
    expect(rows.map(row => row.lastName)).toEqual(["Bernard", "Durand", "Fournier", "Leroy", "Martin", "Moreau", "Petit"])
  })

  it("gives each seat its net amount and payment status", () => {
    expect(rowById.get("stripe")).toMatchObject({ collectedCents: 1500, paymentStatus: "PAID", paymentMethod: "STRIPE" })
    expect(rowById.get("cash")).toMatchObject({ collectedCents: 1200, paymentStatus: "PAID", paymentMethod: "ESPECES" })
    expect(rowById.get("legacy")).toMatchObject({ collectedCents: 800, paymentStatus: "PAID" })
    expect(rowById.get("refunded")).toMatchObject({ collectedCents: 0, paymentStatus: "REFUNDED", paymentMethod: null })
    expect(rowById.get("reserved")).toMatchObject({ collectedCents: null, paymentStatus: "PENDING", paymentMethod: "VIREMENT" })
    expect(rowById.get("exempt")).toMatchObject({ collectedCents: 0, paymentStatus: "FREE", paymentMethod: null })
    expect(rowById.get("walkin")).toMatchObject({ collectedCents: null, paymentStatus: "PENDING" })
  })

  it("marks every seat of a free event as free", () => {
    const freeRows = buildBilanParticipantRows({ seats: [seat({ id: "guest", lastName: "Blanc", rsvp: "CONFIRME" })], ticketIncomes: [], reviews: [], evenementHasFee: false })
    expect(freeRows[0]).toMatchObject({ paymentStatus: "FREE", collectedCents: null })
  })

  it("attaches each review to its seat", () => {
    expect(rowById.get("stripe")?.review).toEqual({ id: "review-1", rating: 5, comment: "Super" })
    expect(rowById.get("cash")?.review).toBeNull()
  })

  it("adds up to exactly the bilan tiles' figures", () => {
    const totals = summarizeBilanParticipantRows(rows)
    const paidSeats = seats.filter(candidate => candidate.isPaid).map(candidate => ({ id: candidate.id, amountCents: candidate.amountCents }))
    expect(totals.revenueCents).toBe(collectedTicketRevenueCents(paidSeats, ticketIncomes))
    expect(totals.revenueCents).toBe(3500)
    expect(totals.presentCount).toBe(seats.filter(candidate => candidate.present).length)
    expect(totals.reviewCount).toBe(reviews.length)
    // Rows = inscrits ∪ présents: the « inscrits » tile leaves out walk-ins and refunded seats
    // that still came.
    expect(totals.participantCount).toBe(seats.filter(candidate => isRegisteredSeat(candidate) || candidate.present).length)
    expect(seats.filter(isRegisteredSeat).length).toBe(5)
  })

  it("keeps a seat that still carries revenue or a review even outside inscrits ∪ présents", () => {
    const strayRows = buildBilanParticipantRows({
      seats:          [seat({ id: "stray", lastName: "Faure" })],
      ticketIncomes:  [{ participationId: "stray", amountCents: 900, status: "PAID" }],
      reviews:        [],
      evenementHasFee: true,
    })
    expect(summarizeBilanParticipantRows(strayRows).revenueCents).toBe(900)
  })
})

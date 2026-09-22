import { describe, expect, it } from "vitest"
import {
  getMemberCardEligibility,
  type MemberCardCotisation,
  type MemberCardEligibilityInput,
} from "@/lib/member-card/eligibility"
import type { CotisationStatus } from "@/lib/cotisation-status"
import { currentCotisationYear, endOfCotisationYear, isMembreAdherent } from "@/lib/membre-adherent"

// Mid-season, well away from any year boundary — cases about the boundary pass their own `now`.
const NOW = new Date("2026-09-19T12:00:00Z")
// 31 Dec 2026 23:59:59.999 in Paris (CET, UTC+1).
const END_OF_2026_PARIS = new Date("2026-12-31T22:59:59.999Z")
const END_OF_2025_PARIS = new Date("2025-12-31T22:59:59.999Z")
// 1 Jan 2026 00:00:00 in Paris (CET, UTC+1).
const START_OF_2026_PARIS = new Date("2025-12-31T23:00:00.000Z")

function buildCotisation(overrides: Partial<MemberCardCotisation> = {}): MemberCardCotisation {
  return { id: "cotisation-2026", year: 2026, status: "PAYE", periodStart: null, periodEnd: null, ...overrides }
}

function buildInput(overrides: Partial<MemberCardEligibilityInput> = {}): MemberCardEligibilityInput {
  return { cardEnabled: true, membre: { status: "ACTIF", deletedAt: null }, cotisations: [], ...overrides }
}

describe("getMemberCardEligibility — the current row's status", () => {
  it.each<[CotisationStatus, ReturnType<typeof getMemberCardEligibility>]>([
    ["PAYE",                { state: "valid", validFrom: START_OF_2026_PARIS, validUntil: END_OF_2026_PARIS, cotisationId: "cotisation-2026" }],
    ["EXONERE",             { state: "valid", validFrom: START_OF_2026_PARIS, validUntil: END_OF_2026_PARIS, cotisationId: "cotisation-2026" }],
    ["EN_ATTENTE",          { state: "unavailable", reason: "pending", cotisationId: "cotisation-2026" }],
    ["PARTIELLEMENT_PAYEE", { state: "unavailable", reason: "partial", cotisationId: "cotisation-2026" }],
    ["EN_RETARD",           { state: "unavailable", reason: "late", cotisationId: "cotisation-2026" }],
    ["ANNULEE",             { state: "none", reason: "cancelled" }],
  ])("%s → %o", (status, expected) => {
    const input = buildInput({ cotisations: [buildCotisation({ status })] })
    expect(getMemberCardEligibility(input, NOW)).toEqual(expected)
  })

  it("treats a free membership (EXONERE, amount 0) as valid — the amount is never looked at", () => {
    const freeMembership = { ...buildCotisation({ status: "EXONERE" }), amount: 0 }
    const input = buildInput({ cotisations: [freeMembership] })
    expect(getMemberCardEligibility(input, NOW)).toEqual({
      state: "valid", validFrom: START_OF_2026_PARIS, validUntil: END_OF_2026_PARIS, cotisationId: "cotisation-2026",
    })
  })
})

describe("getMemberCardEligibility — periodEnd rows vs calendar-year rows", () => {
  it("a calendar-year row is valid until 31 Dec 23:59:59.999 Paris time", () => {
    const result = getMemberCardEligibility(buildInput({ cotisations: [buildCotisation()] }), NOW)
    expect(result).toMatchObject({ state: "valid", validUntil: END_OF_2026_PARIS })
  })

  it("a custom-duration row filed under last year still covers until its periodEnd", () => {
    const periodStart = new Date("2025-09-01T10:00:00Z")
    const periodEnd = new Date("2027-03-01T10:00:00Z")
    const input = buildInput({
      cotisations: [buildCotisation({ id: "six-month-tier", year: 2025, periodStart, periodEnd })],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({
      state: "valid", validFrom: periodStart, validUntil: periodEnd, cotisationId: "six-month-tier",
    })
  })

  it("a custom-duration row of the current year whose periodEnd has passed is expired, not valid", () => {
    const periodEnd = new Date("2026-06-30T10:00:00Z")
    const input = buildInput({ cotisations: [buildCotisation({ periodStart: "2026-01-01T10:00:00Z", periodEnd })] })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "expired", expiredOn: periodEnd })
  })

  it("is still valid at the exact periodEnd instant", () => {
    const input = buildInput({ cotisations: [buildCotisation({ periodEnd: NOW })] })
    expect(getMemberCardEligibility(input, NOW)).toMatchObject({ state: "valid", validUntil: NOW })
  })

  it("accepts ISO strings for dates, as a client-side caller receives them from JSON", () => {
    const input = buildInput({
      cotisations: [buildCotisation({ year: 2025, periodStart: "2025-10-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" })],
    })
    expect(getMemberCardEligibility(input, NOW)).toMatchObject({ state: "valid", validUntil: new Date("2026-10-01T00:00:00.000Z") })
  })

  it("an unpaid custom-duration row covering now makes the card unavailable", () => {
    const input = buildInput({
      cotisations: [buildCotisation({ id: "twelve-month-tier", status: "EN_ATTENTE", year: 2025, periodStart: "2025-11-01T00:00:00Z", periodEnd: "2026-11-01T00:00:00Z" })],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "unavailable", reason: "pending", cotisationId: "twelve-month-tier" })
  })

  it("an unpaid row whose period hasn't started yet is not current", () => {
    const input = buildInput({
      cotisations: [buildCotisation({ status: "EN_ATTENTE", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2027-10-01T00:00:00Z" })],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "no-membership" })
  })
})

describe("getMemberCardEligibility — the Paris year boundary", () => {
  // 31 Dec 23:30 UTC is already 1 Jan 00:30 in Paris: the 2026 season is over there even
  // though a UTC clock (Vercel's) still reads 2026.
  const PARIS_NEW_YEAR_UTC_EVENING = new Date("2026-12-31T23:30:00Z")
  // 31 Dec 22:30 UTC is 23:30 in Paris: still 2026.
  const PARIS_NEW_YEARS_EVE = new Date("2026-12-31T22:30:00Z")

  it("a 2026 calendar-year row still covers at 23:30 Paris time on 31 Dec", () => {
    const input = buildInput({ cotisations: [buildCotisation()] })
    expect(getMemberCardEligibility(input, PARIS_NEW_YEARS_EVE)).toMatchObject({ state: "valid", validUntil: END_OF_2026_PARIS })
  })

  it("a 2026 calendar-year row has expired at 00:30 Paris time on 1 Jan, while UTC still reads 31 Dec", () => {
    const input = buildInput({ cotisations: [buildCotisation()] })
    expect(getMemberCardEligibility(input, PARIS_NEW_YEAR_UTC_EVENING)).toEqual({ state: "expired", expiredOn: END_OF_2026_PARIS })
  })

  it("a 2027 row already covers at 00:30 Paris time on 1 Jan", () => {
    const input = buildInput({ cotisations: [buildCotisation(), buildCotisation({ id: "cotisation-2027", year: 2027 })] })
    expect(getMemberCardEligibility(input, PARIS_NEW_YEAR_UTC_EVENING)).toMatchObject({ state: "valid", cotisationId: "cotisation-2027" })
  })

  it("endOfCotisationYear sits exactly on currentCotisationYear's flip", () => {
    const endOf2026 = endOfCotisationYear(2026)
    expect(endOf2026).toEqual(END_OF_2026_PARIS)
    expect(currentCotisationYear(endOf2026)).toBe(2026)
    expect(currentCotisationYear(new Date(endOf2026.getTime() + 1))).toBe(2027)
  })
})

describe("getMemberCardEligibility — expired vs no-membership", () => {
  it("only a past PAYE row → expired on the end of that season", () => {
    const input = buildInput({ cotisations: [buildCotisation({ id: "cotisation-2025", year: 2025 })] })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "expired", expiredOn: END_OF_2025_PARIS })
  })

  it("several past paid rows → expiredOn is the most recent end", () => {
    const input = buildInput({
      cotisations: [
        buildCotisation({ id: "cotisation-2024", year: 2024 }),
        buildCotisation({ id: "cotisation-2025", year: 2025, status: "EXONERE" }),
      ],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "expired", expiredOn: END_OF_2025_PARIS })
  })

  it.each<CotisationStatus>(["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD", "ANNULEE"])(
    "only a past %s row → no-membership (never paid is not a lapsed membership)",
    (status) => {
      const input = buildInput({ cotisations: [buildCotisation({ year: 2025, status })] })
      expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "no-membership" })
    },
  )

  it("no cotisation at all → no-membership", () => {
    expect(getMemberCardEligibility(buildInput(), NOW)).toEqual({ state: "none", reason: "no-membership" })
  })

  it("a calendar-year row paid ahead for next year is neither valid nor expired", () => {
    const input = buildInput({ cotisations: [buildCotisation({ year: 2027 })] })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "no-membership" })
  })

  it("a past paid row plus a row paid ahead for next year → expired on the past one", () => {
    const input = buildInput({ cotisations: [buildCotisation({ year: 2025 }), buildCotisation({ year: 2027 })] })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "expired", expiredOn: END_OF_2025_PARIS })
  })
})

describe("getMemberCardEligibility — several rows at once", () => {
  it("an old season still covering by periodEnd + a new EN_ATTENTE row → valid on the old one", () => {
    const periodStart = new Date("2025-10-15T10:00:00Z")
    const periodEnd = new Date("2026-10-15T10:00:00Z")
    const input = buildInput({
      cotisations: [
        buildCotisation({ id: "previous-season", year: 2025, periodStart, periodEnd }),
        buildCotisation({ id: "renewal", status: "EN_ATTENTE" }),
      ],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({
      state: "valid", validFrom: periodStart, validUntil: periodEnd, cotisationId: "previous-season",
    })
  })

  it("two covering rows → validUntil is the later end, with that row's id", () => {
    const periodStart = new Date("2026-02-01T10:00:00Z")
    const periodEnd = new Date("2027-02-01T10:00:00Z")
    const input = buildInput({
      cotisations: [
        buildCotisation({ id: "calendar-2026" }),
        buildCotisation({ id: "twelve-month-tier", periodStart, periodEnd }),
      ],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({
      state: "valid", validFrom: periodStart, validUntil: periodEnd, cotisationId: "twelve-month-tier",
    })
  })

  it("a cancelled duplicate next to a live unpaid row → unavailable on the live one", () => {
    const input = buildInput({
      cotisations: [
        buildCotisation({ id: "cancelled-duplicate", status: "ANNULEE" }),
        buildCotisation({ id: "live-row", status: "EN_ATTENTE" }),
      ],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "unavailable", reason: "pending", cotisationId: "live-row" })
  })

  it("an overdue row wins over a pending one", () => {
    const input = buildInput({
      cotisations: [
        buildCotisation({ id: "pending-row", status: "EN_ATTENTE" }),
        buildCotisation({ id: "late-row", status: "EN_RETARD" }),
      ],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "unavailable", reason: "late", cotisationId: "late-row" })
  })

  it("a cancelled current row wins over an older expired season", () => {
    const input = buildInput({
      cotisations: [buildCotisation({ year: 2025 }), buildCotisation({ status: "ANNULEE" })],
    })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "cancelled" })
  })
})

describe("getMemberCardEligibility — member and association state", () => {
  const paidRow = [buildCotisation()]

  it.each(["PENDING", "INACTIF", "SUSPENDU"] as const)("a %s member with a paid row → inactive-member", (status) => {
    const input = buildInput({ membre: { status, deletedAt: null }, cotisations: paidRow })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "inactive-member" })
  })

  it("a soft-deleted ACTIF member with a paid row → inactive-member", () => {
    const input = buildInput({ membre: { status: "ACTIF", deletedAt: new Date("2026-09-01T00:00:00Z") }, cotisations: paidRow })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "inactive-member" })
  })

  it("a soft-deleted member given as an ISO string → inactive-member", () => {
    const input = buildInput({ membre: { status: "ACTIF", deletedAt: "2026-09-01T00:00:00.000Z" }, cotisations: paidRow })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "inactive-member" })
  })

  it("card disabled → disabled, even for a fully paid active member", () => {
    const input = buildInput({ cardEnabled: false, cotisations: paidRow })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "disabled" })
  })

  it("card disabled takes precedence over an inactive member", () => {
    const input = buildInput({ cardEnabled: false, membre: { status: "SUSPENDU", deletedAt: null }, cotisations: paidRow })
    expect(getMemberCardEligibility(input, NOW)).toEqual({ state: "none", reason: "disabled" })
  })
})

describe("getMemberCardEligibility — deliberately stricter than the adhérent badge", () => {
  it("a forced adhérent (adherentOverride) with no cotisation has no card", () => {
    expect(isMembreAdherent({ adherentOverride: true, cotisations: [] }, NOW)).toBe(true)
    expect(getMemberCardEligibility(buildInput(), NOW)).toEqual({ state: "none", reason: "no-membership" })
  })

  it("a dependant covered only through their responsable has no card", () => {
    const dependant = { cotisations: [], responsable: { cotisations: [{ year: 2026, status: "PAYE" as const }] } }
    expect(isMembreAdherent(dependant, NOW)).toBe(true)
    expect(getMemberCardEligibility(buildInput({ cotisations: dependant.cotisations }), NOW)).toEqual({ state: "none", reason: "no-membership" })
  })
})

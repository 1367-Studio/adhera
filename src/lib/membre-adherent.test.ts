import { describe, expect, it } from "vitest"
import {
  cotisationCoversDate,
  cotisationPeriodIncludesDate,
  isMembreAdherent,
  isMembreAdherentViaResponsable,
  membreAdherentCotisationSelect,
  membreAdherentWhereClause,
} from "@/lib/membre-adherent"

// Regression suite for the extraction of cotisationCoversDate out of ownAdherent(): every
// expectation below is the behaviour isMembreAdherent had before the member card existed.
const NOW = new Date("2026-09-19T12:00:00Z")

describe("isMembreAdherent — adherentOverride", () => {
  it("override true makes a member adhérent with no cotisation at all", () => {
    expect(isMembreAdherent({ adherentOverride: true, cotisations: [] }, NOW)).toBe(true)
  })

  it("override false beats a paid current-year cotisation", () => {
    expect(isMembreAdherent({ adherentOverride: false, cotisations: [{ year: 2026, status: "PAYE" }] }, NOW)).toBe(false)
  })

  it("override null falls through to the cotisation", () => {
    expect(isMembreAdherent({ adherentOverride: null, cotisations: [{ year: 2026, status: "PAYE" }] }, NOW)).toBe(true)
    expect(isMembreAdherent({ adherentOverride: null, cotisations: [{ year: 2026, status: "EN_ATTENTE" }] }, NOW)).toBe(false)
  })
})

describe("isMembreAdherent — own cotisations", () => {
  it.each([
    ["PAYE", true], ["EXONERE", true],
    ["EN_ATTENTE", false], ["PARTIELLEMENT_PAYEE", false], ["EN_RETARD", false], ["ANNULEE", false],
  ] as const)("a current-year %s row → %s", (status, expected) => {
    expect(isMembreAdherent({ cotisations: [{ year: 2026, status }] }, NOW)).toBe(expected)
  })

  it("last year's calendar row no longer counts", () => {
    expect(isMembreAdherent({ cotisations: [{ year: 2025, status: "PAYE" }] }, NOW)).toBe(false)
  })

  it("a periodEnd row filed under last year still counts until its periodEnd", () => {
    expect(isMembreAdherent({ cotisations: [{ year: 2025, status: "PAYE", periodEnd: new Date("2026-10-01T00:00:00Z") }] }, NOW)).toBe(true)
  })

  it("a current-year periodEnd row whose periodEnd has passed no longer counts", () => {
    expect(isMembreAdherent({ cotisations: [{ year: 2026, status: "PAYE", periodEnd: new Date("2026-06-30T00:00:00Z") }] }, NOW)).toBe(false)
  })

  it("a periodEnd given as an ISO string (client-side JSON) is compared as a date", () => {
    expect(isMembreAdherent({ cotisations: [{ year: 2025, status: "PAYE", periodEnd: "2026-10-01T00:00:00.000Z" }] }, NOW)).toBe(true)
    expect(isMembreAdherent({ cotisations: [{ year: 2026, status: "PAYE", periodEnd: "2026-06-30T00:00:00.000Z" }] }, NOW)).toBe(false)
  })

  it("the calendar year flips at midnight Paris time, not UTC", () => {
    const calendarRow = { cotisations: [{ year: 2026, status: "PAYE" as const }] }
    expect(isMembreAdherent(calendarRow, new Date("2026-12-31T22:30:00Z"))).toBe(true)
    expect(isMembreAdherent(calendarRow, new Date("2026-12-31T23:30:00Z"))).toBe(false)
  })
})

describe("isMembreAdherent — one-level responsable inheritance", () => {
  const paidResponsable = { cotisations: [{ year: 2026, status: "PAYE" as const }] }

  it("a dependant with nothing of their own inherits their responsable's paid cotisation", () => {
    const dependant = { cotisations: [], responsable: paidResponsable }
    expect(isMembreAdherent(dependant, NOW)).toBe(true)
    expect(isMembreAdherentViaResponsable(dependant, NOW)).toBe(true)
  })

  it("a dependant's own unpaid row doesn't block inheritance (only a covering row or an override does)", () => {
    const dependant = { cotisations: [{ year: 2026, status: "EN_ATTENTE" as const }], responsable: paidResponsable }
    expect(isMembreAdherent(dependant, NOW)).toBe(true)
  })

  it("a dependant's own override false blocks inheritance", () => {
    const dependant = { adherentOverride: false, cotisations: [], responsable: paidResponsable }
    expect(isMembreAdherent(dependant, NOW)).toBe(false)
    expect(isMembreAdherentViaResponsable(dependant, NOW)).toBe(false)
  })

  it("a responsable's override true is inherited", () => {
    expect(isMembreAdherent({ cotisations: [], responsable: { adherentOverride: true, cotisations: [] } }, NOW)).toBe(true)
  })

  it("an unpaid responsable passes nothing on", () => {
    expect(isMembreAdherent({ cotisations: [], responsable: { cotisations: [{ year: 2026, status: "EN_ATTENTE" }] } }, NOW)).toBe(false)
  })

  it("a dependant covered on their own isn't reported as inheriting", () => {
    const dependant = { cotisations: [{ year: 2026, status: "PAYE" as const }], responsable: paidResponsable }
    expect(isMembreAdherentViaResponsable(dependant, NOW)).toBe(false)
  })
})

describe("Prisma fragments mirroring isMembreAdherent — unchanged shape", () => {
  it("membreAdherentCotisationSelect", () => {
    expect(membreAdherentCotisationSelect(NOW)).toEqual({
      where:  { OR: [{ year: 2026 }, { periodEnd: { gte: NOW } }] },
      select: { year: true, status: true, periodEnd: true },
    })
  })

  it("membreAdherentWhereClause", () => {
    const coveringMatch = { status: { in: ["PAYE", "EXONERE"] }, OR: [{ year: 2026 }, { periodEnd: { gte: NOW } }] }
    const ownMatch = {
      OR: [
        { adherentOverride: true },
        { AND: [{ adherentOverride: null }, { cotisations: { some: coveringMatch } }] },
      ],
    }
    const inheritedMatch = { adherentOverride: null, cotisations: { none: coveringMatch }, responsable: ownMatch }
    expect(membreAdherentWhereClause(true, NOW)).toEqual({ OR: [ownMatch, inheritedMatch] })
    expect(membreAdherentWhereClause(false, NOW)).toEqual({ NOT: { OR: [ownMatch, inheritedMatch] } })
  })
})

describe("cotisationCoversDate / cotisationPeriodIncludesDate", () => {
  it("covering ignores periodStart (legacy adhérent rule), the period check doesn't", () => {
    const startsNextMonth = { year: 2026, status: "PAYE" as const, periodStart: "2026-10-01T00:00:00Z", periodEnd: "2027-10-01T00:00:00Z" }
    expect(cotisationCoversDate(startsNextMonth, NOW)).toBe(true)
    expect(cotisationPeriodIncludesDate(startsNextMonth, NOW)).toBe(false)
  })

  it("the period check ignores status", () => {
    expect(cotisationPeriodIncludesDate({ year: 2026, periodStart: null, periodEnd: null }, NOW)).toBe(true)
    expect(cotisationCoversDate({ year: 2026, status: "EN_ATTENTE" }, NOW)).toBe(false)
  })

  it("the period check reads year and periodEnd the same way the covering rule does", () => {
    expect(cotisationPeriodIncludesDate({ year: 2025 }, NOW)).toBe(false)
    expect(cotisationPeriodIncludesDate({ year: 2025, periodEnd: "2026-10-01T00:00:00Z" }, NOW)).toBe(true)
    expect(cotisationPeriodIncludesDate({ year: 2026, periodEnd: "2026-06-30T00:00:00Z" }, NOW)).toBe(false)
  })
})

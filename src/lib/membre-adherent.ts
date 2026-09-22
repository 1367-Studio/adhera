import type { CotisationStatus } from "@/lib/cotisation-status"

// Widened to the full CotisationStatus union (not just the 4 values that actually ever drove
// adherent status) so callers can pass a Cotisation row straight through without narrowing —
// EN_RETARD/ANNULEE just never match ADHERENT_STATUSES below.
export type CotisationStatusForAdherent = CotisationStatus

// Exported for src/lib/member-card/eligibility.ts, which needs the same "counts as paid"
// set to tell an expired card (a past PAYE/EXONERE row) from a member who never had one.
export const ADHERENT_STATUSES: readonly CotisationStatusForAdherent[] = ["PAYE", "EXONERE"]

// periodEnd is set only on a Cotisation produced by a custom-duration MembershipTier (see
// MembershipTier.durationMonths) — null for the ordinary calendar-year row. Accepts a string
// too: this module is called both server-side (a real Prisma Date) and client-side (a Membre
// fetched as JSON, where Date columns arrive as ISO strings) — see isMembreAdherent's callers
// in membre-detail-view.tsx.
export type CotisationYearStatus = { year: number; status: CotisationStatusForAdherent; periodEnd?: Date | string | null }

// Status-agnostic shape for cotisationPeriodIncludesDate below — periodStart is only ever set
// together with periodEnd by the tier-based flows, but a member import (src/inngest/
// membres-import.ts) can carry a start date alone, so neither is assumed to imply the other.
export type CotisationPeriod = { year: number; periodStart?: Date | string | null; periodEnd?: Date | string | null }

// A dependent (responsableId set) with no cotisation/override of their own inherits their
// responsable's adhérent status — this is only one level deep on purpose: a responsable is
// expected to be an adult managing their own membership, never itself a dependent, so we
// don't recurse into responsable.responsable and don't need to guard against cycles.
type ResponsableAdherentInput = {
  adherentOverride?: boolean | null
  cotisations?: CotisationYearStatus[]
}

export interface MembreAdherentInput {
  adherentOverride?: boolean | null
  cotisations?: CotisationYearStatus[]
  responsable?: ResponsableAdherentInput | null
}

// Associations here are French, so the cotisation "year" always flips at midnight Paris
// time — anchoring to the server's local/UTC clock instead would flip everyone back to
// Bénévole up to 2h early on Dec 31st (Vercel serverless functions run in UTC).
export function currentCotisationYear(referenceDate: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", year: "numeric" }).format(referenceDate))
}

// The last instant of cotisation year `year` — 31 Dec 23:59:59.999 Paris time, i.e. exactly
// where currentCotisationYear() above flips to year + 1 — so a calendar-year cotisation
// (periodEnd null) can be given a concrete end date ("carte valable jusqu'au 31/12/2026")
// that agrees with the rule deciding whether it still covers. Paris' offset is read from
// Intl rather than hardcoded as CET (+1) for the same reason currentCotisationYear uses it:
// if French time rules ever change, the two boundaries move together instead of drifting
// an hour apart. Reading the offset at UTC midnight is safe because no DST transition ever
// falls near New Year, so it's the same offset in force at Paris midnight an hour earlier.
export function endOfCotisationYear(year: number): Date {
  const nextYearUtcMidnight = Date.UTC(year + 1, 0, 1)
  const parisOffsetMilliseconds = parisWallClockAsUtc(new Date(nextYearUtcMidnight)) - nextYearUtcMidnight
  return new Date(nextYearUtcMidnight - parisOffsetMilliseconds - 1)
}

// The first instant of cotisation year `year` — 1 Jan 00:00:00 Paris time — the mirror image
// of endOfCotisationYear above, for a calendar-year cotisation (periodStart null) that needs a
// concrete start date (e.g. the member card's "carte valable du 01/01/2026 au 31/12/2026").
export function startOfCotisationYear(year: number): Date {
  const yearUtcMidnight = Date.UTC(year, 0, 1)
  const parisOffsetMilliseconds = parisWallClockAsUtc(new Date(yearUtcMidnight)) - yearUtcMidnight
  return new Date(yearUtcMidnight - parisOffsetMilliseconds)
}

// The Paris wall-clock reading of `instant`, re-expressed as if it were a UTC timestamp —
// subtracting the real instant from it gives Paris' UTC offset at that moment.
function parisWallClockAsUtc(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris", hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(instant)
  const partValue = (partType: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === partType)?.value)
  return Date.UTC(partValue("year"), partValue("month") - 1, partValue("day"), partValue("hour"), partValue("minute"), partValue("second"))
}

// The single "does this cotisation make its member covered at referenceDate" rule — shared
// by the adhérent badge (ownAdherent below, and so isMembreAdherent) and the digital member
// card (src/lib/member-card/eligibility.ts), so the card can never read "valide" while the
// dashboard says Bénévole or the other way round. Only the member's own row is judged here:
// adherentOverride and responsable inheritance stay layered on top in isMembreAdherent.
export function cotisationCoversDate(cotisation: CotisationYearStatus, referenceDate: Date = new Date()): boolean {
  return cotisationCoversInYear(cotisation, currentCotisationYear(referenceDate), referenceDate)
}

// Split out from cotisationCoversDate so ownAdherent can resolve the Paris year once per
// member instead of once per cotisation row.
function cotisationCoversInYear(cotisation: CotisationYearStatus, year: number, referenceDate: Date): boolean {
  if (!ADHERENT_STATUSES.includes(cotisation.status)) return false
  // A custom-duration Cotisation (MembershipTier.durationMonths) is filed under the
  // calendar year it *started* in, but can still be covering today well into the next one
  // (e.g. a 6-month tier bought in November) — periodEnd, when set, is authoritative over
  // the year bucket. A plain calendar-year row (periodEnd null) keeps the original check.
  // Normalized through `new Date(...)` rather than compared directly: a string periodEnd
  // (see the CotisationYearStatus comment above) would otherwise compare against a Date via
  // JS's string coercion, not as a point in time, and silently misjudge cotisations from
  // client-side callers.
  if (!cotisation.periodEnd) return cotisation.year === year
  return new Date(cotisation.periodEnd) >= referenceDate
}

// Whether referenceDate falls inside this cotisation's period, whatever its status — the
// member card needs it to find the *current* row even when it isn't paid yet (EN_ATTENTE →
// "carte disponible après paiement") or was cancelled. Same year/periodEnd reading as
// cotisationCoversInYear, plus a periodStart check that one deliberately doesn't have: the
// adhérent rule (and its Prisma mirrors below) never looked at periodStart, and changing
// that would flip existing members' badges. For a PAYE/EXONERE row this is therefore never
// true where cotisationCoversDate is false, so the two can't disagree on a paid row.
export function cotisationPeriodIncludesDate(cotisation: CotisationPeriod, referenceDate: Date = new Date()): boolean {
  if (cotisation.periodStart && new Date(cotisation.periodStart) > referenceDate) return false
  if (!cotisation.periodEnd) return cotisation.year === currentCotisationYear(referenceDate)
  return new Date(cotisation.periodEnd) >= referenceDate
}

// Returns true/false if this entity's own override or own cotisation determines its
// status, or null if undetermined (caller should fall through to another source, e.g. a
// dependent's responsable).
function ownAdherent(entity: ResponsableAdherentInput, year: number, referenceDate: Date): boolean | null {
  if (entity.adherentOverride !== null && entity.adherentOverride !== undefined) {
    return entity.adherentOverride
  }
  const covers = (entity.cotisations ?? []).some(cotisation => cotisationCoversInYear(cotisation, year, referenceDate))
  return covers ? true : null
}

// A Membre is adhérent when: their own override says so, or their own cotisation for the
// current year is PAYE/EXONERE, or (failing both) their responsable's own override/cotisation
// says so. Falls back to Bénévole otherwise.
export function isMembreAdherent(membre: MembreAdherentInput, referenceDate: Date = new Date()): boolean {
  const year = currentCotisationYear(referenceDate)
  const own = ownAdherent(membre, year, referenceDate)
  if (own !== null) return own
  if (membre.responsable) {
    const viaResponsable = ownAdherent(membre.responsable, year, referenceDate)
    if (viaResponsable !== null) return viaResponsable
  }
  return false
}

// True when a Membre's Adhérent status isn't explained by their own override/cotisation
// and comes entirely from their responsable — lets the UI say *why* someone with no
// cotisation of their own still shows as Adhérent, instead of that looking like a bug.
export function isMembreAdherentViaResponsable(membre: MembreAdherentInput, referenceDate: Date = new Date()): boolean {
  const year = currentCotisationYear(referenceDate)
  if (ownAdherent(membre, year, referenceDate) !== null) return false
  return !!membre.responsable && ownAdherent(membre.responsable, year, referenceDate) === true
}

// Prisma `include` fragment for fetching the cotisation(s) that can determine adherent status
// right now — the current calendar year's row, plus any row whose custom periodEnd (see
// MembershipTier.durationMonths) still covers today even if it's filed under a past year.
// Reused by every query that needs to compute isMembreAdherent, so they all agree on this.
export function membreAdherentCotisationSelect(referenceDate: Date = new Date()) {
  const year = currentCotisationYear(referenceDate)
  // Not `as const`: it would freeze `OR` into a readonly tuple, which Prisma's generated
  // where-input types (a mutable array) then reject.
  return {
    where:  { OR: [{ year }, { periodEnd: { gte: referenceDate } }] },
    select: { year: true, status: true, periodEnd: true },
  }
}

// Prisma `select` fragment for fetching a Membre's responsable with just what
// isMembreAdherent needs to check inheritance.
export function membreAdherentResponsableSelect(referenceDate: Date = new Date()) {
  return {
    select: {
      adherentOverride: true,
      cotisations: membreAdherentCotisationSelect(referenceDate),
    },
  } as const
}

// Mirrors cotisationCoversInYear() as a Prisma `where` fragment — a cotisation counts
// if it's the current calendar year's row, or its custom periodEnd (MembershipTier.
// durationMonths) still covers referenceDate regardless of which year it's filed under.
function coveringCotisationMatch(year: number, referenceDate: Date) {
  return { status: { in: ADHERENT_STATUSES }, OR: [{ year }, { periodEnd: { gte: referenceDate } }] }
}

function ownAdherentWhereMatch(year: number, referenceDate: Date) {
  return {
    OR: [
      { adherentOverride: true },
      { AND: [{ adherentOverride: null }, { cotisations: { some: coveringCotisationMatch(year, referenceDate) } }] },
    ],
  }
}

// Prisma `where` fragment for filtering a Membre list to only adhérents or only bénévoles,
// evaluated at the DB level so pagination/counts stay correct. Mirrors isMembreAdherent,
// including the one-level responsable inheritance for dependents.
export function membreAdherentWhereClause(wantAdherent: boolean, referenceDate: Date = new Date()) {
  const year = currentCotisationYear(referenceDate)
  const ownMatch = ownAdherentWhereMatch(year, referenceDate)
  // Only falls through to the responsable when this member's own override/cotisation left
  // it undetermined — mirrors ownAdherent()'s null case exactly.
  const inheritedMatch = {
    adherentOverride: null,
    cotisations: { none: coveringCotisationMatch(year, referenceDate) },
    responsable: ownAdherentWhereMatch(year, referenceDate),
  }
  return wantAdherent
    ? { OR: [ownMatch, inheritedMatch] }
    : { NOT: { OR: [ownMatch, inheritedMatch] } }
}

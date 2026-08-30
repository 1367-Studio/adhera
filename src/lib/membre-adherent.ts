import type { CotisationStatus } from "@/lib/cotisation-status"

// Widened to the full CotisationStatus union (not just the 4 values that actually ever drove
// adherent status) so callers can pass a Cotisation row straight through without narrowing —
// EN_RETARD/ANNULEE just never match ADHERENT_STATUSES below.
export type CotisationStatusForAdherent = CotisationStatus

const ADHERENT_STATUSES: readonly CotisationStatusForAdherent[] = ["PAYE", "EXONERE"]

// periodEnd is set only on a Cotisation produced by a custom-duration MembershipTier (see
// MembershipTier.durationMonths) — null for the ordinary calendar-year row. Accepts a string
// too: this module is called both server-side (a real Prisma Date) and client-side (a Membre
// fetched as JSON, where Date columns arrive as ISO strings) — see isMembreAdherent's callers
// in membre-detail-view.tsx.
type CotisationYearStatus = { year: number; status: CotisationStatusForAdherent; periodEnd?: Date | string | null }

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

// Returns true/false if this entity's own override or own cotisation determines its
// status, or null if undetermined (caller should fall through to another source, e.g. a
// dependent's responsable).
function ownAdherent(entity: ResponsableAdherentInput, year: number, referenceDate: Date): boolean | null {
  if (entity.adherentOverride !== null && entity.adherentOverride !== undefined) {
    return entity.adherentOverride
  }
  const covers = (entity.cotisations ?? []).some(c => {
    if (!ADHERENT_STATUSES.includes(c.status)) return false
    // A custom-duration Cotisation (MembershipTier.durationMonths) is filed under the
    // calendar year it *started* in, but can still be covering today well into the next one
    // (e.g. a 6-month tier bought in November) — periodEnd, when set, is authoritative over
    // the year bucket. A plain calendar-year row (periodEnd null) keeps the original check.
    // Normalized through `new Date(...)` rather than compared directly: a string periodEnd
    // (see the CotisationYearStatus comment above) would otherwise compare against a Date via
    // JS's string coercion, not as a point in time, and silently misjudge cotisations from
    // client-side callers.
    if (!c.periodEnd) return c.year === year
    return new Date(c.periodEnd) >= referenceDate
  })
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

// Mirrors ownAdherent()'s cotisation check as a Prisma `where` fragment — a cotisation counts
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

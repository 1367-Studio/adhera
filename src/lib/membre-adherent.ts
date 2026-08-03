import type { CotisationStatus } from "@/lib/cotisation-status"

// Widened to the full CotisationStatus union (not just the 4 values that actually ever drove
// adherent status) so callers can pass a Cotisation row straight through without narrowing —
// EN_RETARD/ANNULEE just never match ADHERENT_STATUSES below.
export type CotisationStatusForAdherent = CotisationStatus

const ADHERENT_STATUSES: readonly CotisationStatusForAdherent[] = ["PAYE", "EXONERE"]

type CotisationYearStatus = { year: number; status: CotisationStatusForAdherent }

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
function ownAdherent(entity: ResponsableAdherentInput, year: number): boolean | null {
  if (entity.adherentOverride !== null && entity.adherentOverride !== undefined) {
    return entity.adherentOverride
  }
  if ((entity.cotisations ?? []).some(c => c.year === year && ADHERENT_STATUSES.includes(c.status))) {
    return true
  }
  return null
}

// A Membre is adhérent when: their own override says so, or their own cotisation for the
// current year is PAYE/EXONERE, or (failing both) their responsable's own override/cotisation
// says so. Falls back to Bénévole otherwise.
export function isMembreAdherent(membre: MembreAdherentInput, referenceDate: Date = new Date()): boolean {
  const year = currentCotisationYear(referenceDate)
  const own = ownAdherent(membre, year)
  if (own !== null) return own
  if (membre.responsable) {
    const viaResponsable = ownAdherent(membre.responsable, year)
    if (viaResponsable !== null) return viaResponsable
  }
  return false
}

// True when a Membre's Adhérent status isn't explained by their own override/cotisation
// and comes entirely from their responsable — lets the UI say *why* someone with no
// cotisation of their own still shows as Adhérent, instead of that looking like a bug.
export function isMembreAdherentViaResponsable(membre: MembreAdherentInput, referenceDate: Date = new Date()): boolean {
  const year = currentCotisationYear(referenceDate)
  if (ownAdherent(membre, year) !== null) return false
  return !!membre.responsable && ownAdherent(membre.responsable, year) === true
}

// Prisma `include` fragment for fetching just the current-year cotisation — reused by
// every query that needs to compute isMembreAdherent, so they all agree on "current year".
export function membreAdherentCotisationSelect(referenceDate: Date = new Date()) {
  return {
    where: { year: currentCotisationYear(referenceDate) },
    select: { year: true, status: true },
  } as const
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

function ownAdherentWhereMatch(year: number) {
  return {
    OR: [
      { adherentOverride: true },
      { AND: [{ adherentOverride: null }, { cotisations: { some: { year, status: { in: ADHERENT_STATUSES } } } }] },
    ],
  }
}

// Prisma `where` fragment for filtering a Membre list to only adhérents or only bénévoles,
// evaluated at the DB level so pagination/counts stay correct. Mirrors isMembreAdherent,
// including the one-level responsable inheritance for dependents.
export function membreAdherentWhereClause(wantAdherent: boolean, referenceDate: Date = new Date()) {
  const year = currentCotisationYear(referenceDate)
  const ownMatch = ownAdherentWhereMatch(year)
  // Only falls through to the responsable when this member's own override/cotisation left
  // it undetermined — mirrors ownAdherent()'s null case exactly.
  const inheritedMatch = {
    adherentOverride: null,
    cotisations: { none: { year, status: { in: ADHERENT_STATUSES } } },
    responsable: ownAdherentWhereMatch(year),
  }
  return wantAdherent
    ? { OR: [ownMatch, inheritedMatch] }
    : { NOT: { OR: [ownMatch, inheritedMatch] } }
}

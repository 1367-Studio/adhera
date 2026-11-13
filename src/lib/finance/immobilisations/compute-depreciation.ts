// src/lib/finance/immobilisations/compute-depreciation.ts
// Pure calculation, no DB access — the linear (méthode linéaire) dotation an Immobilisation
// owes for one exercice, in cents. Uses the French PCG's standard 30/360 day-count convention
// for prorata temporis (every month counts as exactly 30 days, every year as 360) — the
// textbook convention French accounting uses for a non-full-year depreciation period, and what
// keeps the ticket's "computador de 1.200€, 3 anos, uso desde o dia 1" example landing on an
// exact 400€/exercice instead of a slightly-off real-calendar-days figure.
import { exclusiveEndOfDay } from "@/lib/finance/exercice"

export interface DepreciableAsset {
  entryValueCents:     number
  residualValueCents:  number
  usageStartDate:      Date
  usefulLifeMonths:    number
  disposalDate:        Date | null
}

export interface ExercicePeriod {
  startDate: Date
  endDate:   Date // inclusive, same convention as ExerciceComptable.endDate
}

function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
}

// A single ordinal on the 30-day-month/360-day-year calendar — the difference between two of
// these is the day-count between two real dates under that convention.
function days360Ordinal(date: Date): number {
  return date.getUTCFullYear() * 360 + date.getUTCMonth() * 30 + Math.min(date.getUTCDate(), 30)
}

// The dotation (in cents) one specific exercice owes for one asset, given how much has
// already accumulated in prior exercices (cumulativeBeforeCents — from the latest
// ImmobilisationDepreciation row, or 0 if none). Zero when the asset isn't in use yet during
// this exercice, is already fully depreciated, or was disposed of before this exercice started.
export function computeDotationCents(
  asset: DepreciableAsset,
  exercice: ExercicePeriod,
  cumulativeBeforeCents: number,
): number {
  const totalDepreciableCents = asset.entryValueCents - asset.residualValueCents
  if (totalDepreciableCents <= 0 || asset.usefulLifeMonths <= 0) return 0

  const usageEndDate   = addMonthsUTC(asset.usageStartDate, asset.usefulLifeMonths) // exclusive
  const effectiveEnd   = asset.disposalDate && asset.disposalDate < usageEndDate ? asset.disposalDate : usageEndDate
  const exclusiveExerciceEnd = exclusiveEndOfDay(exercice.endDate)

  const windowStart = asset.usageStartDate > exercice.startDate ? asset.usageStartDate : exercice.startDate
  const windowEnd    = effectiveEnd < exclusiveExerciceEnd ? effectiveEnd : exclusiveExerciceEnd
  if (windowStart >= windowEnd) return 0

  const overlapDays360 = days360Ordinal(windowEnd) - days360Ordinal(windowStart)
  if (overlapDays360 <= 0) return 0

  const totalLifeDays360 = asset.usefulLifeMonths * 30
  const rawDotationCents = Math.round((totalDepreciableCents * overlapDays360) / totalLifeDays360)

  // Never let rounding (or a disposal) push the cumulative total past what's actually
  // depreciable — the last period absorbs whatever remainder is left.
  const remainingCents = totalDepreciableCents - cumulativeBeforeCents
  return Math.max(0, Math.min(rawDotationCents, remainingCents))
}

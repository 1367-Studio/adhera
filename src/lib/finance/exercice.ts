// src/lib/finance/exercice.ts
import { prisma } from "@/lib/prisma/client"

export async function resolveExerciceForDate(
  associationId: string,
  date: Date,
): Promise<string | null> {
  const exercice = await prisma.exerciceComptable.findFirst({
    where: {
      associationId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true },
  })

  return exercice?.id ?? null
}

export interface ExerciceRange {
  id:        string
  label:     string
  startDate: Date
  endDate:   Date
}

export function findOverlappingExercice(
  existing: ExerciceRange[],
  range:    { startDate: Date; endDate: Date },
): ExerciceRange | null {
  return existing.find(e => range.startDate <= e.endDate && e.startDate <= range.endDate) ?? null
}

export interface ExerciceGap {
  gapStart: Date
  gapEnd:   Date
  gapDays:  number
}

const ONE_DAY_MS = 86_400_000

function gapBetween(afterEndOf: Date, beforeStartOf: Date): ExerciceGap | null {
  const gapStart = new Date(afterEndOf.getTime() + ONE_DAY_MS)
  const gapEnd   = new Date(beforeStartOf.getTime() - ONE_DAY_MS)
  if (gapStart > gapEnd) return null
  const gapDays = Math.round((gapEnd.getTime() - gapStart.getTime()) / ONE_DAY_MS) + 1
  return { gapStart, gapEnd, gapDays }
}

// Assume `existing` does not overlap with `range` (verified separately by findOverlappingExercice)
// — identifies the nearest exercise before and after `range` and reports the first gap of
// orphaned days found on either side.
export function findExerciceGap(
  existing: ExerciceRange[],
  range:    { startDate: Date; endDate: Date },
): ExerciceGap | null {
  const before = existing
    .filter(e => e.endDate < range.startDate)
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0]
  const after = existing
    .filter(e => e.startDate > range.endDate)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0]

  if (before) {
    const gap = gapBetween(before.endDate, range.startDate)
    if (gap) return gap
  }
  if (after) {
    const gap = gapBetween(range.endDate, after.startDate)
    if (gap) return gap
  }
  return null
}

export interface ExercicePattern {
  startMonth: number
  startDay:   number
  endMonth:   number
  endDay:     number
// true if the initial fiscal year ends in the calendar year following its start
// (e.g., Sept. 2025 → Aug. 2026) — allows for "split-year" fiscal periods.
  spansYearBoundary: boolean
}

// Financial year derived from the very first financial year created by the association —
// this is the one that establishes the fiscal calendar once and for all (see POST /finances/exercices).
export function derivePattern(founding: { startDate: Date; endDate: Date }): ExercicePattern {
  return {
    startMonth: founding.startDate.getUTCMonth() + 1,
    startDay:   founding.startDate.getUTCDate(),
    endMonth:   founding.endDate.getUTCMonth() + 1,
    endDay:     founding.endDate.getUTCDate(),
    spansYearBoundary: founding.endDate.getUTCFullYear() > founding.startDate.getUTCFullYear(),
  }
}

export function expectedRangeForYear(pattern: ExercicePattern, startYear: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(startYear, pattern.startMonth - 1, pattern.startDay)),
    endDate:   new Date(Date.UTC(startYear + (pattern.spansYearBoundary ? 1 : 0), pattern.endMonth - 1, pattern.endDay)),
  }
}

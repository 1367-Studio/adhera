import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeIncomeStatementPeriod, findPreviousExercice, reconcileCustomCategoryLines } from "@/lib/finance/income-statement"
import { ensureDefaultFinanceCategories } from "@/lib/finance/default-categories"

// ?exerciceId — defaults to the most recent exercice (open or not) when omitted, mirroring
// how the exercices list itself already sorts (startDate asc, so the last entry is latest).
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const exerciceIdParam = new URL(req.url).searchParams.get("exerciceId") ?? undefined

  const exercices = await prisma.exerciceComptable.findMany({
    where:   { associationId },
    orderBy: { startDate: "asc" },
    select:  { id: true, label: true, startDate: true, endDate: true },
  })

  if (exercices.length === 0) {
    return NextResponse.json({ exercices: [], current: null, previous: null })
  }

  const current = exerciceIdParam
    ? exercices.find(e => e.id === exerciceIdParam) ?? exercices[exercices.length - 1]
    : exercices[exercices.length - 1]

  const previous = findPreviousExercice(exercices, current)

  // Default categories are normally created by a treasurer visiting Comptabilité > Catégories
  // (or clicking "Initialiser") — an association that never did that still needs real category
  // rows the moment it opens this report, otherwise the "à catégoriser" → categorize picker has
  // nothing to offer (the report's own calculation tolerates a missing default via a virtual
  // line, but assigning a category to a transaction needs a real id to PATCH onto it).
  await ensureDefaultFinanceCategories(associationId)

  const [currentPeriod, previousPeriod] = await Promise.all([
    computeIncomeStatementPeriod(associationId, current),
    computeIncomeStatementPeriod(associationId, previous),
  ])

  // A custom category active in only one of the two periods otherwise has no row on the other
  // side to align against in a side-by-side current/N-1 table — see reconcileCustomCategoryLines.
  reconcileCustomCategoryLines(currentPeriod, previousPeriod)

  return NextResponse.json({
    exercices: exercices.map(e => ({ id: e.id, label: e.label, startDate: e.startDate, endDate: e.endDate })),
    current:   currentPeriod,
    previous:  previousPeriod,
  })
}, { area: "comptabilite", module: "finances" })

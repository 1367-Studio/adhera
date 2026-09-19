import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeIncomeStatementPeriod, findPreviousExercice } from "@/lib/finance/income-statement"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

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

  const [currentPeriod, previousPeriod] = await Promise.all([
    computeIncomeStatementPeriod(associationId, current),
    computeIncomeStatementPeriod(associationId, previous),
  ])

  return NextResponse.json({
    exercices: exercices.map(e => ({ id: e.id, label: e.label })),
    current:   currentPeriod,
    previous:  previousPeriod,
  })
}, { roles: FINANCE, module: "finances" })

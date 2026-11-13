import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeBilanPeriod } from "@/lib/finance/bilan"
import { findPreviousExercice } from "@/lib/finance/income-statement"
import { validateOpeningBalance, validateTrialBalance } from "@/lib/finance/journal/validate-journal"

// ?exerciceId — defaults to the most recent exercice when omitted, same contract as
// /api/finances/rapports/compte-resultat.
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

  const [currentPeriod, previousPeriod, openingIssues, trialBalanceIssues] = await Promise.all([
    computeBilanPeriod(associationId, current),
    computeBilanPeriod(associationId, previous),
    validateOpeningBalance(associationId, current.id),
    validateTrialBalance(associationId, current.id),
  ])
  // A Bilan with a missing opening entry (or an unbalanced trial balance, which should never
  // happen by construction — see postJournalEntry — but is checked anyway as a defense against
  // a future write path that bypasses it) can still look "balanced" on screen: both sides are
  // just silently missing the same prior-exercice baseline. Surface it as a real issue on the
  // period being shown instead of leaving it only reachable via validateJournalForExercice,
  // which nothing currently calls.
  currentPeriod.issues = [...currentPeriod.issues, ...openingIssues, ...trialBalanceIssues]

  return NextResponse.json({
    exercices: exercices.map(e => ({ id: e.id, label: e.label, startDate: e.startDate, endDate: e.endDate })),
    current:   currentPeriod,
    previous:  previousPeriod,
  })
}, { area: "comptabilite", module: "finances" })

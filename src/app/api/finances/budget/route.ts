import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeBudgetPeriod } from "@/lib/finance/budget"

// ?exerciceId — defaults to the most recent exercice (open or not) when omitted, same
// convention as /api/finances/rapports/compte-resultat.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const exerciceIdParam = new URL(req.url).searchParams.get("exerciceId") ?? undefined

  const exercices = await prisma.exerciceComptable.findMany({
    where:   { associationId },
    orderBy: { startDate: "asc" },
    select:  { id: true, label: true, startDate: true, endDate: true },
  })

  if (exercices.length === 0) {
    return NextResponse.json({ exercices: [], budget: null })
  }

  const current = exerciceIdParam
    ? exercices.find(e => e.id === exerciceIdParam) ?? exercices[exercices.length - 1]
    : exercices[exercices.length - 1]

  const budget = await computeBudgetPeriod(associationId, current)

  return NextResponse.json({
    exercices: exercices.map(e => ({ id: e.id, label: e.label, startDate: e.startDate, endDate: e.endDate })),
    budget,
  })
}, { area: "comptabilite", module: "finances" })

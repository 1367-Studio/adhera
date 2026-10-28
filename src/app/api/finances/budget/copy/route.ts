import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { budgetCopySchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { findPreviousExercice } from "@/lib/finance/budget"

const lineKey = (categoryId: string, projectId: string | null) => `${categoryId}|${projectId ?? ""}`

// Copies the previous exercice's BudgetLine forecasts onto a target exercice — "sans projet"
// lines always, plus whichever projects' lines the caller selected (or every project when
// `projectIds: "all"`, archived included: copying a past budget shouldn't silently skip a
// project just because it got archived since). Only ever touches BudgetLine rows — never
// Income/Expense — so this can't affect realizado.
export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = budgetCopySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { targetExerciceId, projectIds, confirmOverwrite } = parsed.data

  const exercices = await prisma.exerciceComptable.findMany({
    where:   { associationId },
    orderBy: { startDate: "asc" },
    select:  { id: true, label: true, startDate: true, endDate: true },
  })
  const target = exercices.find(e => e.id === targetExerciceId)
  if (!target) return NextResponse.json({ error: "Exercice cible introuvable" }, { status: 404 })

  const previous = findPreviousExercice(exercices, target)
  if (!previous) return NextResponse.json({ error: "Aucun exercice précédent à copier" }, { status: 422 })

  const sourceLines = await prisma.budgetLine.findMany({
    where: {
      associationId, exerciceId: previous.id,
      ...(projectIds === "all" ? {} : { OR: [{ projectId: null }, { projectId: { in: projectIds } }] }),
    },
    select: { categoryId: true, projectId: true, amount: true },
  })
  if (sourceLines.length === 0) {
    return NextResponse.json({ copied: 0 })
  }

  const existingTargetLines = await prisma.budgetLine.findMany({
    where:  { associationId, exerciceId: targetExerciceId },
    select: { id: true, categoryId: true, projectId: true, amount: true },
  })
  const existingByKey = new Map(existingTargetLines.map(l => [lineKey(l.categoryId, l.projectId), l]))

  const hasConflict = sourceLines.some(l => {
    const existing = existingByKey.get(lineKey(l.categoryId, l.projectId))
    return existing !== undefined && Number(existing.amount) !== 0
  })
  if (hasConflict && !confirmOverwrite) {
    return NextResponse.json({ error: "CONFIRM_OVERWRITE_REQUIRED", conflict: true }, { status: 409 })
  }

  await prisma.$transaction(sourceLines.map(line => {
    const existing = existingByKey.get(lineKey(line.categoryId, line.projectId))
    return existing
      ? prisma.budgetLine.update({ where: { id: existing.id }, data: { amount: line.amount } })
      : prisma.budgetLine.create({ data: { associationId, exerciceId: targetExerciceId, categoryId: line.categoryId, projectId: line.projectId, amount: line.amount } })
  }))

  await writeActivityLog({
    associationId, actorId: userId, action: "BUDGET_COPIED", entity: "ExerciceComptable", entityId: targetExerciceId,
    label: `${previous.label} → ${target.label}`,
  })

  return NextResponse.json({ copied: sourceLines.length })
}, { area: "comptabilite", module: "finances" })

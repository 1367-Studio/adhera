import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { budgetProjectUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeBudgetPeriod } from "@/lib/finance/budget"

// ?exerciceId — same convention as the global GET /api/finances/budget. A project with no
// exercices yet at all still resolves (empty budget, previsto/realizado all zero).
export const GET = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx
  const exerciceIdParam = new URL(req.url).searchParams.get("exerciceId") ?? undefined

  const project = await prisma.budgetProject.findFirst({ where: { id, associationId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 })

  const exercices = await prisma.exerciceComptable.findMany({
    where:   { associationId },
    orderBy: { startDate: "asc" },
    select:  { id: true, label: true, startDate: true, endDate: true },
  })
  if (exercices.length === 0) return NextResponse.json({ exercices: [], budget: null })

  const current = exerciceIdParam
    ? exercices.find(e => e.id === exerciceIdParam) ?? exercices[exercices.length - 1]
    : exercices[exercices.length - 1]

  const budget = await computeBudgetPeriod(associationId, current, id)

  return NextResponse.json({
    exercices: exercices.map(e => ({ id: e.id, label: e.label, startDate: e.startDate, endDate: e.endDate })),
    budget,
  })
}, { area: "comptabilite", module: "finances" })

// Also handles archive/unarchive via `archived: true/false` — there is no DELETE route: a
// project with real Income/Expense or BudgetLine history is never hard-deleted, only retired
// (see BudgetProject's doc comment in schema.prisma).
export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.budgetProject.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = budgetProjectUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { name, description, archived } = parsed.data

  const project = await prisma.budgetProject.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    },
  })

  await writeActivityLog({
    associationId, actorId: userId,
    action: archived !== undefined ? (archived ? "BUDGET_PROJECT_ARCHIVED" : "BUDGET_PROJECT_UNARCHIVED") : "BUDGET_PROJECT_UPDATED",
    entity: "BudgetProject", entityId: id, label: project.name,
  })
  return NextResponse.json(project)
}, { area: "comptabilite", module: "finances" })

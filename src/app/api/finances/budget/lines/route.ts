import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { budgetLineUpsertSchema, budgetLineDeleteSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

// Upserts one BudgetLine. Not a plain `prisma.budgetLine.upsert()`: the "only one 'sans
// projet' row per exercice+catégorie" rule is enforced by a pair of PARTIAL unique indexes
// written by hand in the migration (Postgres treats NULL as distinct in a regular unique
// index, so a plain compound unique can't express "unique only when projectId IS NULL") —
// partial indexes aren't representable in schema.prisma's `@@unique`, so there's no Prisma
// compound-unique selector to upsert against. find-then-write instead.
export const PATCH = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = budgetLineUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { exerciceId, categoryId, amount } = parsed.data
  const projectId = parsed.data.projectId ?? null

  const [exercice, category, project] = await Promise.all([
    prisma.exerciceComptable.findFirst({ where: { id: exerciceId, associationId }, select: { id: true } }),
    prisma.financeCategory.findFirst({ where: { id: categoryId, associationId }, select: { id: true, name: true } }),
    projectId ? prisma.budgetProject.findFirst({ where: { id: projectId, associationId }, select: { id: true } }) : Promise.resolve(null),
  ])
  if (!exercice) return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 })
  if (!category) return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 })
  if (projectId && !project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 })

  const existing = await prisma.budgetLine.findFirst({ where: { exerciceId, categoryId, projectId } })

  const line = existing
    ? await prisma.budgetLine.update({ where: { id: existing.id }, data: { amount } })
    : await prisma.budgetLine.create({ data: { associationId, exerciceId, categoryId, projectId, amount } })

  await writeActivityLog({
    associationId, actorId: userId, action: "BUDGET_LINE_UPDATED", entity: "BudgetLine", entityId: line.id,
    label: `${category.name}${projectId ? "" : " (sans projet)"}`,
  })

  return NextResponse.json(line)
}, { area: "comptabilite", module: "finances" })

// Detaches a category from a project's budget — the undo for "Adicionar catégorie au
// projet". Always safe to delete: if the category still has real Income/Expense activity
// under that project, computeBudgetPeriod's `relevantCategories` filter keeps showing it
// anyway (see src/lib/finance/budget.ts), so this can never hide real money, only an unused
// zero-amount forecast row.
export const DELETE = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = budgetLineDeleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { exerciceId, categoryId, projectId } = parsed.data

  const existing = await prisma.budgetLine.findFirst({
    where:  { associationId, exerciceId, categoryId, projectId },
    include: { category: { select: { name: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Ligne introuvable" }, { status: 404 })

  await prisma.budgetLine.delete({ where: { id: existing.id } })

  await writeActivityLog({
    associationId, actorId: userId, action: "BUDGET_LINE_REMOVED_FROM_PROJECT", entity: "BudgetLine", entityId: existing.id,
    label: existing.category.name,
  })

  return new NextResponse(null, { status: 204 })
}, { area: "comptabilite", module: "finances" })

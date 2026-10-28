// src/lib/finance/budget.ts
import { prisma } from "@/lib/prisma/client"
import { ensureDefaultFinanceCategories } from "@/lib/finance/default-categories"
import {
  emptyBudgetPeriod,
  type BudgetPeriod, type BudgetCategoryLine, type BudgetProjectBreakdownEntry, type ExerciceRef,
} from "@/lib/finance/budget-shared"

export type { ExerciceRef, BudgetPeriod }
export { findPreviousExercice } from "@/lib/finance/income-statement"

// Computes the "Orçamento previsto" payload for one exercice — either the global budget
// (projectId omitted) or one project's scoped budget (projectId given).
//
// Global view: previsto per category = sum of every BudgetLine for that category in this
// exercice, across every project AND the "sans projet" line (projectId null) — never stored
// as a separate number, always this sum (see BudgetLine's doc comment in schema.prisma).
// Realizado per category = every Income/Expense in that category for this exercice,
// regardless of project — an operation linked to a project still counts once here.
//
// Project view: previsto per category = that project's own BudgetLine amount only (0 if
// never set). Realizado per category = only Income/Expense linked to both that category AND
// that project. The category list itself is the union of categories the project has a
// forecast for and categories it has real activity in — a category never silently drops off
// just because nobody set a previsto for it yet.
export async function computeBudgetPeriod(
  associationId: string,
  exercice:      ExerciceRef | null,
  projectId?:    string,
): Promise<BudgetPeriod> {
  if (!exercice) return emptyBudgetPeriod(null)

  let projectSummary: BudgetPeriod["project"] = null
  if (projectId) {
    const project = await prisma.budgetProject.findFirst({
      where:  { id: projectId, associationId },
      select: { id: true, name: true, description: true, archivedAt: true },
    })
    if (!project) return emptyBudgetPeriod(exercice)
    projectSummary = {
      id: project.id, name: project.name, description: project.description,
      archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
    }
  }

  // Guarantees every default category has a real FinanceCategory row before the table
  // renders — unlike the Compte de résultat report (which tolerates a missing default via a
  // "virtual" zero-amount line, since it never needs to accept input on it), every row of the
  // budget table must be immediately editable, which requires a real categoryId to PATCH a
  // BudgetLine onto. Same helper already used for this exact reason elsewhere (see its doc
  // comment in default-categories.ts).
  await ensureDefaultFinanceCategories(associationId)

  const incomeWhere  = { associationId, exerciceId: exercice.id, status: "PAID" as const,      ...(projectId ? { projectId } : {}) }
  const expenseWhere = { associationId, exerciceId: exercice.id, status: "VALIDATED" as const,  ...(projectId ? { projectId } : {}) }

  const [categories, budgetLines, incomeGroups, expenseGroups, projects] = await Promise.all([
    prisma.financeCategory.findMany({
      where:  { associationId },
      select: { id: true, key: true, name: true, isDefault: true, type: true },
    }),
    prisma.budgetLine.findMany({
      where:  { associationId, exerciceId: exercice.id },
      select: { categoryId: true, projectId: true, amount: true },
    }),
    prisma.income.groupBy({ by: ["categoryId", "projectId"], where: incomeWhere, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ["categoryId", "projectId"], where: expenseWhere, _sum: { amount: true } }),
    projectId ? Promise.resolve([]) : prisma.budgetProject.findMany({ where: { associationId }, select: { id: true, name: true } }),
  ])

  const projectNameById = new Map(projects.map(p => [p.id, p.name]))

  // Previsto per category, plus (global view only) the per-project breakdown used by the
  // "expand a category" drill-down.
  const previstoByCategory  = new Map<string, number>()
  const breakdownByCategory = new Map<string, BudgetProjectBreakdownEntry[]>()
  for (const line of budgetLines) {
    const amount = Number(line.amount)
    if (projectId) {
      if (line.projectId !== projectId) continue
      previstoByCategory.set(line.categoryId, (previstoByCategory.get(line.categoryId) ?? 0) + amount)
      continue
    }
    previstoByCategory.set(line.categoryId, (previstoByCategory.get(line.categoryId) ?? 0) + amount)
    const breakdown = breakdownByCategory.get(line.categoryId) ?? []
    breakdown.push({
      projectId:   line.projectId,
      projectName: line.projectId ? (projectNameById.get(line.projectId) ?? null) : null,
      amount,
    })
    breakdownByCategory.set(line.categoryId, breakdown)
  }

  // Realizado per category (summed across projects for the global view; already filtered to
  // one project for the project view), plus the uncategorized ("à catégoriser") bucket.
  function sumRealized(groups: { categoryId: string | null; _sum: { amount: unknown } }[]) {
    const byCategory = new Map<string, number>()
    let uncategorizedTotal = 0
    for (const row of groups) {
      const amount = Number(row._sum.amount ?? 0)
      if (!row.categoryId) { uncategorizedTotal += amount; continue }
      byCategory.set(row.categoryId, (byCategory.get(row.categoryId) ?? 0) + amount)
    }
    return { byCategory, uncategorizedTotal }
  }
  const incomeRealized  = sumRealized(incomeGroups)
  const expenseRealized = sumRealized(expenseGroups)

  // Uncategorized transaction counts need their own query — groupBy's _sum alone doesn't
  // carry a row count, and pulling it through _count on the same groupBy would force every
  // categorized group to carry a count nobody reads just to get the one uncategorized count.
  const [uncategorizedIncomeCount, uncategorizedExpenseCount] = await Promise.all([
    prisma.income.count({ where: { ...incomeWhere, categoryId: null } }),
    prisma.expense.count({ where: { ...expenseWhere, categoryId: null } }),
  ])

  const period = emptyBudgetPeriod(exercice, projectSummary)

  // Global view: every category of the association (default + custom) always gets a row,
  // even with previsto=realizado=0 — the point of the screen is to let a future/empty
  // category still be forecast. Project view: only categories the project actually has a
  // forecast or real activity in — a project's category set is implicit in its BudgetLine
  // rows (see schema.prisma doc comment), not every category of the association.
  const relevantCategories = projectId
    ? categories.filter(c => previstoByCategory.has(c.id) || incomeRealized.byCategory.has(c.id) || expenseRealized.byCategory.has(c.id))
    : categories

  for (const cat of relevantCategories) {
    const realizedMap = cat.type === "INCOME" ? incomeRealized.byCategory : expenseRealized.byCategory
    const line: BudgetCategoryLine = {
      categoryId: cat.id,
      key:        cat.key,
      name:       cat.name,
      isDefault:  cat.isDefault,
      previsto:   previstoByCategory.get(cat.id) ?? 0,
      realizado:  realizedMap.get(cat.id) ?? 0,
      projectBreakdown: breakdownByCategory.get(cat.id) ?? [],
    }
    if (cat.type === "INCOME") period.income.push(line)
    else period.expense.push(line)
  }

  period.uncategorizedIncome  = { previsto: 0, realizado: incomeRealized.uncategorizedTotal,  count: uncategorizedIncomeCount }
  period.uncategorizedExpense = { previsto: 0, realizado: expenseRealized.uncategorizedTotal, count: uncategorizedExpenseCount }

  const sum = (lines: BudgetCategoryLine[], key: "previsto" | "realizado") => lines.reduce((acc, l) => acc + l[key], 0)

  const incomePrevisto  = sum(period.income, "previsto")
  const incomeRealizado = sum(period.income, "realizado") + period.uncategorizedIncome.realizado
  const expensePrevisto  = sum(period.expense, "previsto")
  const expenseRealizado = sum(period.expense, "realizado") + period.uncategorizedExpense.realizado

  period.totals = {
    income:  { previsto: incomePrevisto,  realizado: incomeRealizado },
    expense: { previsto: expensePrevisto, realizado: expenseRealizado },
    result:  { previsto: incomePrevisto - expensePrevisto, realizado: incomeRealizado - expenseRealizado },
  }

  // Default categories always sort first (same reading order as Compte de résultat), custom
  // categories after, both alphabetically within their group.
  const byDefaultThenName = (a: BudgetCategoryLine, b: BudgetCategoryLine) =>
    (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1)
  period.income.sort(byDefaultThenName)
  period.expense.sort(byDefaultThenName)

  return period
}

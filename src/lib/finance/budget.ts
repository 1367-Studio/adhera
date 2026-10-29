// src/lib/finance/budget.ts
import { prisma } from "@/lib/prisma/client"
import { ensureDefaultFinanceCategories } from "@/lib/finance/default-categories"
import { type CategoryRow, resolveIncomeCategory, resolveExpenseCategory } from "@/lib/finance/category-resolution"
import {
  emptyBudgetPeriod,
  type BudgetPeriod, type BudgetCategoryLine, type BudgetProjectBreakdownEntry, type ExerciceRef, type TransactionDetail,
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

  const [categories, budgetLines, incomeRows, expenseRows, projects] = await Promise.all([
    prisma.financeCategory.findMany({
      where:  { associationId },
      select: { id: true, key: true, name: true, accountingCode: true, section: true, isDefault: true, type: true, archivedAt: true },
    }),
    prisma.budgetLine.findMany({
      where:  { associationId, exerciceId: exercice.id },
      select: { categoryId: true, projectId: true, amount: true },
    }),
    // Full rows (not groupBy) so resolveIncomeCategory can apply the SAME origin-id/legacy
    // fallback the Compte de résultat uses (see category-resolution.ts) — a groupBy on the
    // literal categoryId column would count any row created without an explicit categoryId as
    // uncategorized even when the Compte de résultat correctly resolves it, which was exactly
    // the mismatch between the two reports this unification fixes.
    prisma.income.findMany({
      where:  incomeWhere,
      select: {
        id: true, date: true, paymentMethod: true, reference: true, description: true,
        categoryId: true, cotisationPaymentId: true, donId: true, commandeId: true, participationId: true, facturePaymentId: true, projectId: true, amount: true,
        membre: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.expense.findMany({
      where:  expenseWhere,
      select: { id: true, date: true, paymentMethod: true, reference: true, description: true, vendor: true, factureRecueId: true, categoryId: true, projectId: true, amount: true },
    }),
    projectId ? Promise.resolve([]) : prisma.budgetProject.findMany({ where: { associationId }, select: { id: true, name: true } }),
  ])

  const categoriesById  = new Map(categories.map(c => [c.id, c as CategoryRow]))
  const categoriesByKey = new Map(categories.filter(c => c.key).map(c => [c.key as string, c as CategoryRow]))
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

  // Same origin-label mapping as income-statement.ts's incomeOrigin/incomePersonName — kept
  // local rather than imported since those two are private to that module and the join shapes
  // differ slightly (budget.ts doesn't need don/commande/participation person names: an
  // uncategorized Income practically only ever comes from a manual entry or the Stripe
  // overpayment safety net, neither of which carries one of those origin ids at all).
  function incomeOriginLabel(row: { cotisationPaymentId: string | null; donId: string | null; commandeId: string | null; participationId: string | null; facturePaymentId: string | null }): string {
    if (row.cotisationPaymentId) return "Adhésion"
    if (row.donId) return "Don"
    if (row.commandeId) return "Boutique"
    if (row.participationId) return "Événement"
    if (row.facturePaymentId) return "Facture"
    return "Saisie manuelle"
  }

  // Realizado per category, resolved the SAME way the Compte de résultat resolves it
  // (categoryId → origin id → legacy description → "à catégoriser") — see category-resolution.ts.
  // `incomeRows`/`expenseRows` are already scoped to the project when projectId is given (the
  // where-clause above), so no extra per-row project filtering is needed here.
  function sumRealizedIncome() {
    const byCategory = new Map<string, number>()
    let uncategorizedTotal = 0
    const uncategorizedTransactions: TransactionDetail[] = []
    for (const row of incomeRows) {
      const amount   = Number(row.amount)
      const resolved = resolveIncomeCategory(row, categoriesById, categoriesByKey)
      if (!resolved || !resolved.categoryId) {
        uncategorizedTotal += amount
        uncategorizedTransactions.push({
          id: row.id, type: "INCOME", date: row.date.toISOString(), amount,
          paymentMethod: row.paymentMethod, origin: incomeOriginLabel(row),
          personName: row.membre ? `${row.membre.firstName} ${row.membre.lastName}`.trim() : null,
          reference: row.reference, description: row.description,
        })
        continue
      }
      byCategory.set(resolved.categoryId, (byCategory.get(resolved.categoryId) ?? 0) + amount)
    }
    return { byCategory, uncategorizedTotal, uncategorizedTransactions }
  }
  function sumRealizedExpense() {
    const byCategory = new Map<string, number>()
    let uncategorizedTotal = 0
    const uncategorizedTransactions: TransactionDetail[] = []
    for (const row of expenseRows) {
      const amount   = Number(row.amount)
      const resolved = resolveExpenseCategory(row, categoriesById)
      if (!resolved || !resolved.categoryId) {
        uncategorizedTotal += amount
        uncategorizedTransactions.push({
          id: row.id, type: "EXPENSE", date: row.date.toISOString(), amount,
          paymentMethod: row.paymentMethod, origin: row.factureRecueId ? "Facture fournisseur" : "Saisie manuelle",
          personName: row.vendor, reference: row.reference, description: row.description,
        })
        continue
      }
      byCategory.set(resolved.categoryId, (byCategory.get(resolved.categoryId) ?? 0) + amount)
    }
    return { byCategory, uncategorizedTotal, uncategorizedTransactions }
  }
  const incomeRealized  = sumRealizedIncome()
  const expenseRealized = sumRealizedExpense()

  const period = emptyBudgetPeriod(exercice, projectSummary)

  // Global view: every ACTIVE category of the association (default + custom) always gets a
  // row, even with previsto=realizado=0 — the point of the screen is to let a future/empty
  // category still be forecast. An archived category only reappears if it still has real
  // previsto/realizado — otherwise a category a treasurer archived from Comptabilité >
  // Catégories would keep showing up here as a fully editable forecast row forever, which is
  // exactly the "still looks alive" inconsistency archiving is meant to fix. Project view:
  // same "has activity" rule already applied to every category — a project's category set is
  // implicit in its BudgetLine rows (see schema.prisma doc comment), not every category of the
  // association.
  const hasActivity = (c: CategoryRow) => previstoByCategory.has(c.id) || incomeRealized.byCategory.has(c.id) || expenseRealized.byCategory.has(c.id)
  const relevantCategories = projectId
    ? categories.filter(hasActivity)
    : categories.filter(c => !c.archivedAt || hasActivity(c))

  for (const cat of relevantCategories) {
    const realizedMap = cat.type === "INCOME" ? incomeRealized.byCategory : expenseRealized.byCategory
    const line: BudgetCategoryLine = {
      categoryId: cat.id,
      key:        cat.key,
      name:       cat.name,
      type:       cat.type,
      isDefault:  cat.isDefault,
      previsto:   previstoByCategory.get(cat.id) ?? 0,
      realizado:  realizedMap.get(cat.id) ?? 0,
      projectBreakdown: breakdownByCategory.get(cat.id) ?? [],
    }
    // IMMOBILISATION categories (capital assets/depreciation) are informational — never mixed
    // into income/expense, never summed into totals below (see budget-shared.ts doc comment).
    if (cat.section === "IMMOBILISATION") period.immobilisation.push(line)
    else if (cat.type === "INCOME") period.income.push(line)
    else period.expense.push(line)
  }

  period.uncategorizedIncome  = { previsto: 0, realizado: incomeRealized.uncategorizedTotal,  count: incomeRealized.uncategorizedTransactions.length,  transactions: incomeRealized.uncategorizedTransactions }
  period.uncategorizedExpense = { previsto: 0, realizado: expenseRealized.uncategorizedTotal, count: expenseRealized.uncategorizedTransactions.length, transactions: expenseRealized.uncategorizedTransactions }

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
  period.immobilisation.sort(byDefaultThenName)

  return period
}

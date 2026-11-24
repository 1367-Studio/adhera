// src/lib/finance/dashboard-stats.ts
// Painel totals, scoped by plain date range (not exerciceId) — deliberately kept decoupled
// from the Exercice model so associations with irregular/split fiscal years keep the exact
// year-selector behavior the Painel already has. Mirrors computeIncomeStatementPeriod's own
// totalIncome/totalExpense combination (src/lib/finance/income-statement.ts) so the two screens
// can never disagree on sign again: both exclude IN_KIND/IMMOBILISATION (see RESULT_SECTIONS's
// own doc comment) and both include uncategorized rows in the total.
import { prisma } from "@/lib/prisma/client"
import { RESULT_SECTIONS } from "@/lib/finance/income-statement-shared"
import { resolveIncomeCategory, resolveExpenseCategory, type CategoryRow } from "@/lib/finance/category-resolution"

export interface FinanceDashboardTotals {
  totalIncome:  number
  totalExpense: number
}

async function loadCategoryMaps(associationId: string) {
  const categories = await prisma.financeCategory.findMany({
    where:  { associationId, archivedAt: null },
    select: { id: true, key: true, name: true, accountingCode: true, section: true, isDefault: true, type: true },
  })
  const categoriesById  = new Map(categories.map(c => [c.id, c as CategoryRow]))
  const categoriesByKey = new Map(categories.filter(c => c.key).map(c => [c.key as string, c as CategoryRow]))
  return { categoriesById, categoriesByKey }
}

export async function computeFinanceDashboardTotals(
  associationId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<FinanceDashboardTotals> {
  const dateFilter = (dateFrom || dateTo) ? {
    date: {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
    },
  } : {}

  const [{ categoriesById, categoriesByKey }, incomeRows, expenseRows, depreciationDotation] = await Promise.all([
    loadCategoryMaps(associationId),
    prisma.income.findMany({
      where:  { associationId, status: "PAID", ...dateFilter },
      select: {
        amount: true, categoryId: true, cotisationPaymentId: true, donId: true,
        commandeId: true, participationId: true, facturePaymentId: true, description: true,
      },
    }),
    prisma.expense.findMany({
      where:  { associationId, status: "VALIDATED", ...dateFilter },
      select: { amount: true, categoryId: true },
    }),
    // 681110/681120 (dotations aux amortissements, FORM-107 Fase 2/3) never post as an Expense
    // row — post-closing-depreciation.ts writes straight to the journal — so without this the
    // Painel would still drift from the DRE for any association with active depreciation
    // schedules. Mirrors income-statement.ts's own synthetic dotation line exactly, just scoped
    // by date range (JournalEntry.date) instead of exerciceId to match this function's own scope.
    prisma.journalLine.aggregate({
      where: {
        journalEntry: { associationId, ...dateFilter },
        chartAccount: { code: { in: ["681110", "681120"] } },
      },
      _sum: { debit: true, credit: true },
    }),
  ])

  let totalIncome = 0
  for (const row of incomeRows) {
    const resolved = resolveIncomeCategory(row, categoriesById, categoriesByKey)
    if (!resolved || (RESULT_SECTIONS as readonly string[]).includes(resolved.section)) {
      totalIncome += Number(row.amount)
    }
  }

  let totalExpense = 0
  for (const row of expenseRows) {
    const resolved = resolveExpenseCategory(row, categoriesById)
    if (!resolved || (RESULT_SECTIONS as readonly string[]).includes(resolved.section)) {
      totalExpense += Number(row.amount)
    }
  }
  totalExpense += Number(depreciationDotation._sum.debit ?? 0) - Number(depreciationDotation._sum.credit ?? 0)

  return { totalIncome, totalExpense }
}

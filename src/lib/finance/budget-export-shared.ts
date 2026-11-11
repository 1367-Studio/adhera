// Shared between the PDF and Excel budget exports (src/lib/pdf/budget-pdf-client.ts and the
// exportExcel() in previsionnel-global-tab.tsx/previsionnel-project-tab.tsx) so both read the
// exact same row order and "what counts as a section header" rule — never two independent
// walks of BudgetPeriod that could silently drift.
import type { BudgetPeriod } from "@/lib/finance/budget-shared"

export interface BudgetExportRow {
  label:     string
  // null on both fields together = a section header (no amounts, no écart/%) — never null on
  // just one, since every real row (category, uncategorized bucket, total, résultat) always
  // carries both numbers, even when one of them is 0.
  previsto:  number | null
  realizado: number | null
  bold?:     boolean
}

export interface BudgetExportLabels {
  income:        string
  expense:       string
  uncategorized: string
  total:         string
  result:        string
}

export function buildBudgetExportRows(budget: BudgetPeriod, labels: BudgetExportLabels): BudgetExportRow[] {
  const rows: BudgetExportRow[] = []

  rows.push({ label: labels.income, previsto: null, realizado: null, bold: true })
  for (const line of budget.income) rows.push({ label: line.name, previsto: line.previsto, realizado: line.realizado })
  if (budget.uncategorizedIncome.count > 0) {
    rows.push({ label: labels.uncategorized, previsto: 0, realizado: budget.uncategorizedIncome.realizado })
  }
  rows.push({ label: labels.total, previsto: budget.totals.income.previsto, realizado: budget.totals.income.realizado, bold: true })

  rows.push({ label: labels.expense, previsto: null, realizado: null, bold: true })
  for (const line of budget.expense) rows.push({ label: line.name, previsto: line.previsto, realizado: line.realizado })
  if (budget.uncategorizedExpense.count > 0) {
    rows.push({ label: labels.uncategorized, previsto: 0, realizado: budget.uncategorizedExpense.realizado })
  }
  rows.push({ label: labels.total, previsto: budget.totals.expense.previsto, realizado: budget.totals.expense.realizado, bold: true })

  rows.push({ label: labels.result, previsto: budget.totals.result.previsto, realizado: budget.totals.result.realizado, bold: true })

  return rows
}

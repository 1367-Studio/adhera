// src/lib/finance/income-statement-shared.ts
// Split out from income-statement.ts because that module imports `prisma` (server-only) —
// this half is safe to import from the client component that renders the report.

// Fixed template — same set of lines every period, in this order, whether or not a given
// association has any activity in a bucket (a legal/statutory report reads the same shape
// year over year; see Estrutura do demonstrativo in the feature request).
export const INCOME_BUCKETS  = ["cotisations", "dons", "subventions", "boutique", "evenements", "autres"] as const
export const EXPENSE_BUCKETS = ["assurance", "communication", "materiel", "transport", "fraisBancaires", "location", "equipement", "autres"] as const

export type IncomeBucket  = typeof INCOME_BUCKETS[number]
export type ExpenseBucket = typeof EXPENSE_BUCKETS[number]

export interface ExerciceRef {
  id:        string
  label:     string
  startDate: Date
  endDate:   Date
}

export interface IncomeStatementPeriod {
  exercice:  ExerciceRef | null
  income:    Record<IncomeBucket, number>
  expense:   Record<ExpenseBucket, number>
  totalIncome:  number
  totalExpense: number
  result:       number
}

// Exercice labels are free text (see ExerciceComptable.label) and land directly in export
// file names — a split-fiscal-year label like "2025/2026" would otherwise be read as a path
// separator by the OS/browser and break or truncate the download.
export function sanitizeForFilename(label: string): string {
  return label.replace(/[\\/:*?"<>|]/g, "-")
}

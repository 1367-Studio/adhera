// src/lib/finance/income-statement-shared.ts
// Split out from income-statement.ts because that module imports `prisma` (server-only) —
// this half is safe to import from the client component that renders the report.

// Mirrors the Prisma `FinanceSection` enum as a plain string union so this file stays
// importable from client components without pulling in `@prisma/client`'s generated runtime.
export const FINANCE_SECTIONS = ["OPERATING", "FINANCIAL", "EXCEPTIONAL", "OTHER", "IN_KIND", "IMMOBILISATION"] as const
export type FinanceSectionKey = typeof FINANCE_SECTIONS[number]

// IMMOBILISATION holds capital-asset purchases and depreciation/amortization (classe 2 / 68
// du PCG) — informational only. It's never summed into totalIncome/totalExpense/result (see
// computeIncomeStatementPeriod/computeBudgetPeriod): a capital purchase isn't a current
// operating charge, and this first version doesn't implement depreciation schedules (see
// FORM-reformulation plan). Internal treasury transfers between an association's own bank
// accounts are a separate, still-unmodeled limitation — see the help text on the categories
// admin screen; they must never be entered as an Income/Expense at all, in any section.
export const RESULT_SECTIONS = FINANCE_SECTIONS.filter(s => s !== "IMMOBILISATION")

export interface ExerciceRef {
  id:        string
  label:     string
  startDate: Date
  endDate:   Date
}

export interface TransactionDetail {
  id:            string
  type:          "INCOME" | "EXPENSE"
  date:          string // ISO
  amount:        number
  paymentMethod: string | null
  // Human-readable origin label: "Adhésion", "Don", "Boutique", "Événement", "Facture",
  // "Saisie manuelle"... — never the raw origin id, this is for display/export only.
  origin:        string
  personName:    string | null
  reference:     string | null
  description:   string | null
}

export interface CategoryLine {
  // null when the row is "virtual" — a system bucket (e.g. a default category the association
  // deleted) resolved from DEFAULT_FINANCE_CATEGORIES metadata rather than a real FinanceCategory
  // row. Never null for a custom category or a still-existing default category.
  categoryId:     string | null
  key:            string | null
  name:           string
  accountingCode: string | null
  isDefault:      boolean
  amount:         number
  transactions:   TransactionDetail[]
}

export interface SectionLines {
  income:  CategoryLine[]
  expense: CategoryLine[]
}

export interface UncategorizedBucket {
  amount:       number
  count:        number
  transactions: TransactionDetail[]
}

export interface IncomeStatementPeriod {
  exercice: ExerciceRef | null
  sections: Record<FinanceSectionKey, SectionLines>
  // Separate per type — a mixed count would be meaningless in a two-column (Receitas |
  // Despesas) layout where each column needs its own alert.
  uncategorizedIncome:  UncategorizedBucket
  uncategorizedExpense: UncategorizedBucket
  totalIncome:       number
  totalExpense:      number
  // Receitas - despesas da seção OPERATING somente (item 13 do pedido) — distinto de `result`,
  // que soma todas as seções (OPERATING + FINANCIAL + EXCEPTIONAL + OTHER + IN_KIND).
  resultOperational: number
  result:            number
}

// Exercice labels are free text (see ExerciceComptable.label) and land directly in export
// file names — a split-fiscal-year label like "2025/2026" would otherwise be read as a path
// separator by the OS/browser and break or truncate the download.
export function sanitizeForFilename(label: string): string {
  return label.replace(/[\\/:*?"<>|]/g, "-")
}

// src/lib/finance/income-statement-shared.ts
// Split out from income-statement.ts because that module imports `prisma` (server-only) —
// this half is safe to import from the client component that renders the report.

// Mirrors the Prisma `FinanceSection` enum as a plain string union so this file stays
// importable from client components without pulling in `@prisma/client`'s generated runtime.
export const FINANCE_SECTIONS = ["OPERATING", "FINANCIAL", "EXCEPTIONAL", "OTHER", "IN_KIND", "IMMOBILISATION"] as const
export type FinanceSectionKey = typeof FINANCE_SECTIONS[number]

// Sections rendered inside the Produits/Charges columns on the Compte de résultat screen and
// export (FORM-104). IMMOBILISATION never appears there (reserved for the future Bilan →
// Actif → Immobilisations corporelles screen) and IN_KIND gets its own full-width block below
// the result instead (see InKindContributionsSection in reports-view.tsx).
export const STATEMENT_SECTIONS = FINANCE_SECTIONS.filter(s => s !== "IMMOBILISATION" && s !== "IN_KIND")

// IMMOBILISATION holds capital-asset purchases and depreciation/amortization (classe 2 / 68
// du PCG) — informational only. It's never summed into totalIncome/totalExpense/result (see
// computeIncomeStatementPeriod/computeBudgetPeriod): a capital purchase isn't a current
// operating charge, and this first version doesn't implement depreciation schedules (see
// FORM-reformulation plan). Internal treasury transfers between an association's own bank
// accounts are a separate, still-unmodeled limitation — see the help text on the categories
// admin screen; they must never be entered as an Income/Expense at all, in any section.
// IN_KIND (contributions volontaires en nature, classe 86/87 du PCG associatif) is excluded
// for the same reason (FORM-104): emplois/contributions are shown as their own matched pair
// below the result line, so including them here would double-count them into Total des
// produits/Total des charges even though they're always equal and net to zero on `result`.
export const RESULT_SECTIONS = FINANCE_SECTIONS.filter(s => s !== "IMMOBILISATION" && s !== "IN_KIND")

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
  // que soma as seções RESULT_SECTIONS (OPERATING + FINANCIAL + EXCEPTIONAL + OTHER — não
  // IMMOBILISATION nem IN_KIND, ver RESULT_SECTIONS acima).
  resultOperational: number
  result:            number
}

// Exercice labels are free text (see ExerciceComptable.label) and land directly in export
// file names — a split-fiscal-year label like "2025/2026" would otherwise be read as a path
// separator by the OS/browser and break or truncate the download.
export function sanitizeForFilename(label: string): string {
  return label.replace(/[\\/:*?"<>|]/g, "-")
}

// FORM-104: the Compte de résultat's year columns must show just the year(s) ("2026"), never
// the free-text exercice.label ("Exercice 2026" or a custom split-year label) — derived from
// the exercice's own dates instead of parsed out of that label, same approach already used for
// `CurrentPeriod`/`spansYearBoundary` in src/lib/finance/exercice.ts.
export function yearLabelForPeriod(period: { startDate: Date | string; endDate: Date | string }): string {
  const startYear = new Date(period.startDate).getUTCFullYear()
  const endYear   = new Date(period.endDate).getUTCFullYear()
  return startYear === endYear ? String(startYear) : `${startYear}–${endYear}`
}

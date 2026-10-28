// src/lib/finance/budget-shared.ts
// Split out from budget.ts because that module imports `prisma` (server-only) — this half is
// safe to import from client components that render the Budget prévisionnel screen.
import type { ExerciceRef } from "@/lib/finance/income-statement-shared"

export type { ExerciceRef }

export interface BudgetProjectBreakdownEntry {
  // null = the "sans projet" part of this category's forecast.
  projectId:   string | null
  projectName: string | null
  amount:      number
}

export interface BudgetCategoryLine {
  categoryId: string
  key:        string | null
  name:       string
  isDefault:  boolean
  previsto:   number
  realizado:  number
  // Only populated on the global budget payload (expand-to-see-projects) — empty on a
  // project-scoped payload, where the category's forecast is already a single number.
  projectBreakdown: BudgetProjectBreakdownEntry[]
}

export interface BudgetUncategorizedBucket {
  previsto:  number // always 0 — "à catégoriser" has no forecast of its own, only realizado
  realizado: number
  count:     number
}

export interface BudgetTotal {
  previsto:  number
  realizado: number
}

export interface BudgetPeriod {
  exercice: ExerciceRef | null
  // null on the global payload; the BudgetProject summary on a project-scoped payload.
  project:  { id: string; name: string; description: string | null; archivedAt: string | null } | null
  income:   BudgetCategoryLine[]
  expense:  BudgetCategoryLine[]
  uncategorizedIncome:  BudgetUncategorizedBucket
  uncategorizedExpense: BudgetUncategorizedBucket
  totals: {
    income:  BudgetTotal
    expense: BudgetTotal
    result:  BudgetTotal
  }
}

export function emptyBudgetPeriod(exercice: ExerciceRef | null, project: BudgetPeriod["project"] = null): BudgetPeriod {
  return {
    exercice,
    project,
    income:  [],
    expense: [],
    uncategorizedIncome:  { previsto: 0, realizado: 0, count: 0 },
    uncategorizedExpense: { previsto: 0, realizado: 0, count: 0 },
    totals: {
      income:  { previsto: 0, realizado: 0 },
      expense: { previsto: 0, realizado: 0 },
      result:  { previsto: 0, realizado: 0 },
    },
  }
}

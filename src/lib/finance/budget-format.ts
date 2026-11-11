// src/lib/finance/budget-format.ts
// Pure helpers shared between the Budget prévisionnel API computation (src/lib/finance/budget.ts),
// the on-screen tables/cards, and the PDF/Excel export — kept in one place so the three can
// never drift on what "75% realizados" or a favorable/unfavorable color means.

// "Diferença / % realização": diff is always shown; percent is null ("—" in the UI) whenever
// previsto <= 0 — covers both "previsto is exactly zero" (category forecast rule) and
// "previsto is negative" (only possible on the Resultado card, a planned deficit).
export function budgetDiff(previsto: number, realizado: number): number {
  return realizado - previsto
}

export function budgetDiffPercent(previsto: number, realizado: number): number | null {
  if (previsto <= 0) return null
  return (realizado / previsto) * 100
}

export type BudgetTone = "favorable" | "unfavorable" | "neutral"

// Exceeding a revenue forecast is favorable (more money than planned); exceeding an expense
// forecast is unfavorable (spent more than planned). Falling short of either is left neutral —
// the spec only calls out the "exceeding" case explicitly.
export function budgetLineTone(type: "income" | "expense", previsto: number, realizado: number): BudgetTone {
  if (realizado === previsto) return "neutral"
  if (type === "income")  return realizado > previsto ? "favorable" : "neutral"
  return realizado > previsto ? "unfavorable" : "neutral"
}

// Same "exceeding is favorable" logic applied to the net Resultado (receitas − despesas): a
// realized result better than the planned one is favorable, worse is unfavorable.
export function budgetResultTone(previstoResult: number, realizadoResult: number): BudgetTone {
  if (realizadoResult === previstoResult) return "neutral"
  return realizadoResult > previstoResult ? "favorable" : "unfavorable"
}

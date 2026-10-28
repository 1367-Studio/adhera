"use client"

import { useState } from "react"
import { budgetDiff, budgetDiffPercent, type BudgetTone } from "@/lib/finance/budget-format"
import { cn } from "@/lib/utils"

// Shared between the global and per-project budget tables (previsionnel-global-tab.tsx,
// previsionnel-project-tab.tsx) so the "X € · Y% réalisé" formatting and the inline-edit
// input never drift between the two screens.
export const fmtBudgetCurrency = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function DiffPercentCell({ previsto, realizado, tone }: { previsto: number; realizado: number; tone: BudgetTone }) {
  const diff    = budgetDiff(previsto, realizado)
  const percent = budgetDiffPercent(previsto, realizado)
  const toneClass = tone === "favorable" ? "text-green-700 dark:text-green-400" : tone === "unfavorable" ? "text-destructive" : "text-muted-foreground"
  return (
    <span className={cn("tabular-nums", toneClass)}>
      {diff === 0 ? fmtBudgetCurrency(0) : diff.toLocaleString("fr-FR", { style: "currency", currency: "EUR", signDisplay: "exceptZero" })}
      {" · "}
      {percent === null ? "—" : `${Math.round(percent)}%`}
    </span>
  )
}

export function InlineAmountCell({ value, onSave, disabled }: { value: number; onSave: (amount: number) => Promise<void>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(() => String(value))
  const [saving, setSaving]   = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setDraft(String(value)); setEditing(true) }}
        className="w-full rounded px-2 py-1 text-right tabular-nums hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
      >
        {fmtBudgetCurrency(value)}
      </button>
    )
  }

  async function commit() {
    const parsed = Number(draft.replace(",", "."))
    setEditing(false)
    if (Number.isNaN(parsed) || parsed < 0 || parsed === value) return
    setSaving(true)
    try {
      await onSave(parsed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <input
      type="number"
      min={0}
      step="0.01"
      autoFocus
      disabled={saving}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") setEditing(false)
      }}
      className="w-full rounded-md border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
    />
  )
}

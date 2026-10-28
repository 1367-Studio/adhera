"use client"

import { hexToRgba } from "@/lib/finance-palette"
import { cn } from "@/lib/utils"
import { budgetDiff, budgetDiffPercent, type BudgetTone } from "@/lib/finance/budget-format"

interface Props {
  label:     string
  previsto:  number
  realizado: number
  tone:      BudgetTone
  icon:      React.ElementType
  isLoading: boolean
  previstoLabel:  string
  diffLabel:      string
  percentLabel:   string
}

// Same visual language as StatTile (src/components/dashboard/widgets/stat-tile.tsx) — same
// flat `bg-muted/60` tile, same icon tint — but StatTile only carries one value + one detail
// line, and these cards need four numbers (realizado, previsto, diferença, %realizado), so
// this is its own component rather than forcing StatTile's shape to stretch.
const ICON_TINT = "#023D9D"

const fmtCurrency = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
const fmtSignedCurrency = (n: number) => (n === 0 ? fmtCurrency(0) : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", signDisplay: "exceptZero" }))

const toneClass: Record<BudgetTone, string> = {
  favorable:   "text-green-700 dark:text-green-400",
  unfavorable: "text-destructive",
  neutral:     "text-muted-foreground",
}

export function BudgetStatTile({ label, previsto, realizado, tone, icon: Icon, isLoading, previstoLabel, diffLabel, percentLabel }: Props) {
  const diff    = budgetDiff(previsto, realizado)
  const percent = budgetDiffPercent(previsto, realizado)

  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg bg-muted/60 p-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium">{label}</span>
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: hexToRgba(ICON_TINT, 0.12) }}
        >
          <Icon className="size-4.5" style={{ color: ICON_TINT }} />
        </span>
      </div>

      {isLoading ? (
        <span className="text-[1.75rem] leading-none font-medium tabular-nums animate-pulse text-muted-foreground">…</span>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-[1.75rem] leading-none font-medium tabular-nums">{fmtCurrency(realizado)}</span>
          <span className="text-sm text-muted-foreground">
            {previstoLabel} {fmtCurrency(previsto)}
            {" · "}
            <span className={cn("tabular-nums", toneClass[tone])}>
              {diffLabel} {fmtSignedCurrency(diff)}
            </span>
            {" · "}
            <span className={cn("tabular-nums", toneClass[tone])}>
              {percent === null ? "—" : `${Math.round(percent)}%`} {percentLabel}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}

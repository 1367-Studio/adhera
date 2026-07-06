"use client"

import { useQuery } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  Tooltip, LabelList, ResponsiveContainer,
} from "recharts"
import { useModules } from "@/lib/user-context"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type FinanceChartsData = {
  year:             number
  hasCotisations:   boolean
  hasFinances:      boolean
  cotisations:      { status: string; label: string; count: number; amount: number }[]
  monthly:          { label: string; recettes: number; depenses: number }[]
  incomeByCategory: { name: string; amount: number }[]
}

// ─── Palette (validated — see docs/audit-2026-07-06.md conventions / dataviz skill) ──
// Light/dark steps from the reference categorical palette; assignment (which hue means
// which entity) is fixed and never re-derived from the data, only the L/C step swaps
// per mode.

function usePalette() {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  return {
    dark,
    recettes:   "#008300",                  // green — identical step both modes
    depenses:   dark ? "#e66767" : "#e34948", // red
    payees:     "#008300",                  // green
    enAttente:  dark ? "#c98500" : "#eda100", // yellow
    exonerees:  dark ? "#3987e5" : "#2a78d6", // blue
    sequential: dark ? "#3987e5" : "#2a78d6", // blue, single hue for magnitude ranking
    axis:       "#898781",                   // muted ink — same both modes
    grid:       dark ? "#2c2c2a" : "#e1e0d9", // hairline gridline
    cursor:     dark ? "rgba(255,255,255,0.06)" : "rgba(11,11,11,0.05)",
  }
}

function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
}

// ─── Tooltips (values lead, series name follows; line-key not a box) ──────────

function MonthlyTip({ active, payload, label, pal }: {
  active?: boolean; label?: string
  payload?: { value: number; dataKey: string }[]
  pal: ReturnType<typeof usePalette>
}) {
  if (!active || !payload?.length) return null
  const recettes = payload.find(p => p.dataKey === "recettes")?.value ?? 0
  const depenses = payload.find(p => p.dataKey === "depenses")?.value ?? 0
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="font-medium">{label}</p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: pal.recettes }} />
        <span className="text-muted-foreground">Recettes</span>
        <span className="font-semibold ml-auto">{fmt(recettes)}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: pal.depenses }} />
        <span className="text-muted-foreground">Dépenses</span>
        <span className="font-semibold ml-auto">{fmt(depenses)}</span>
      </p>
    </div>
  )
}

function CategoryTip({ active, payload }: {
  active?: boolean
  payload?: { value: number; payload: { name: string } }[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="font-semibold">{fmt(payload[0].value)}</p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FinanceCharts() {
  const modules = useModules()
  const pal     = usePalette()

  const { data, isLoading } = useQuery<FinanceChartsData>({
    queryKey: ["dashboard", "finance-charts"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard/finance-charts")
      if (!res.ok) throw new Error("Erreur")
      return res.json()
    },
    enabled:   modules.cotisations || modules.finances,
    staleTime: 5 * 60_000,
  })

  if (!modules.cotisations && !modules.finances) return null

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-48 rounded-xl border bg-card animate-pulse" />
        <div className="h-48 rounded-xl border bg-card animate-pulse lg:col-span-2" />
      </div>
    )
  }

  if (!data) return null

  if (!data.hasCotisations && !data.hasFinances) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Les graphiques apparaîtront ici dès que des cotisations ou des mouvements financiers seront enregistrés.
        </p>
      </div>
    )
  }

  const cotisationTotal = data.cotisations.reduce((s, c) => s + c.amount, 0)
  const cotisationCount = data.cotisations.reduce((s, c) => s + c.count, 0)
  // Amount is the natural denominator, but an association where every cotisation is
  // EXONERE (amount 0) would otherwise divide by zero and render a blank bar despite
  // having real data — fall back to splitting by headcount instead.
  const cotisationDenom = cotisationTotal > 0 ? cotisationTotal : cotisationCount
  const cotisationColor: Record<string, string> = {
    PAYE: pal.payees, EN_ATTENTE: pal.enAttente, EXONERE: pal.exonerees,
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">

      {/* Cotisations — part-to-whole → stacked bar, never a donut */}
      {data.hasCotisations && (
        <div className={cn("rounded-xl border bg-card p-5", !data.hasFinances && "lg:col-span-3")}>
          <p className="mb-4 text-xs font-medium text-muted-foreground">Cotisations {data.year}</p>

          <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md">
            {data.cotisations.map(c => (
              <div
                key={c.status}
                style={{
                  width:      `${cotisationDenom > 0 ? Math.max(((cotisationTotal > 0 ? c.amount : c.count) / cotisationDenom) * 100, 2) : 0}%`,
                  background: cotisationColor[c.status] ?? pal.axis,
                }}
                className="first:rounded-l-md last:rounded-r-md"
              />
            ))}
          </div>

          <div className="mt-3 space-y-1.5">
            {data.cotisations.map(c => (
              <div key={c.status} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: cotisationColor[c.status] ?? pal.axis }} />
                  <span className="text-muted-foreground">{c.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-muted-foreground">{c.count}</span>
                  <span className="w-20 text-right tabular-nums font-medium">{fmt(c.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recettes vs Dépenses — trend over time, 2 distinct series → grouped bar */}
      {data.hasFinances && (
        <div className={`rounded-xl border bg-card p-5 ${data.hasCotisations ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <p className="mb-4 text-xs font-medium text-muted-foreground">Recettes vs dépenses — 6 derniers mois</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.monthly} barGap={2} barCategoryGap="30%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={pal.grid} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
              <YAxis hide />
              <Tooltip content={<MonthlyTip pal={pal} />} cursor={{ fill: pal.cursor }} />
              <Legend
                iconType="square"
                wrapperStyle={{ fontSize: 12, color: pal.axis }}
                formatter={(value) => (value === "recettes" ? "Recettes" : "Dépenses")}
              />
              <Bar dataKey="recettes" name="recettes" fill={pal.recettes} radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="depenses" name="depenses" fill={pal.depenses} radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recettes par catégorie — magnitude ranking → single-hue sequential bar */}
      {data.hasFinances && data.incomeByCategory.length > 0 && (
        <div className="rounded-xl border bg-card p-5 lg:col-span-3">
          <p className="mb-4 text-xs font-medium text-muted-foreground">Recettes par catégorie — {data.year}</p>
          <ResponsiveContainer width="100%" height={Math.max(data.incomeByCategory.length * 36, 80)}>
            <BarChart
              data={data.incomeByCategory}
              layout="vertical"
              barSize={16}
              margin={{ top: 0, right: 88, bottom: 0, left: 8 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: pal.axis, fontFamily: "inherit" }}
                width={140}
              />
              <Tooltip content={<CategoryTip />} cursor={{ fill: pal.cursor }} />
              <Bar dataKey="amount" fill={pal.sequential} radius={[0, 4, 4, 0]}>
                <LabelList dataKey="amount" position="right" formatter={(v: unknown) => fmt(Number(v))} style={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

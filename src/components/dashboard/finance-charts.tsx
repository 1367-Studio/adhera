"use client"

import { useQuery } from "@tanstack/react-query"
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend,
  Tooltip, LabelList, ResponsiveContainer,
} from "recharts"
import { useModules } from "@/lib/user-context"
import { usePalette } from "@/lib/finance-palette"
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

// Lollipop mark (thick rounded line + end dot) instead of a filled block — reads
// lighter/more current than a solid bar. The end dot is a surface-color ring with a
// smaller colored center (dataviz skill: "dots carry a surface-color ring so they
// stay legible where they cross the line"), not a solid colored disc.
function LollipopBar({ x, y, width, height, color }: {
  x?: number; y?: number; width?: number; height?: number; color: string
}) {
  if (x == null || y == null || width == null || height == null) return null
  const cy      = y + height / 2
  const outerR  = Math.min(height / 2 + 1, 9)
  const innerR  = outerR * 0.45
  const x2      = Math.max(x + width - outerR, x)
  return (
    <g style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}>
      <line x1={x} y1={cy} x2={x2} y2={cy} stroke={color} strokeWidth={6} strokeLinecap="round" />
      <circle cx={x + width} cy={cy} r={outerR} fill="var(--card)" stroke={color} strokeWidth={2} />
      <circle cx={x + width} cy={cy} r={innerR} fill={color} />
    </g>
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
  const paidAmount = data.cotisations.find(c => c.status === "PAYE")?.amount ?? 0
  const paidPct    = cotisationTotal > 0 ? Math.round((paidAmount / cotisationTotal) * 100) : 0

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">

      {/* Cotisations — part-to-whole → stacked bar, never a donut */}
      {data.hasCotisations && (
        <div className={cn(
          "relative overflow-hidden rounded-xl border bg-card p-6 dark:border-white/10 dark:shadow-lg dark:shadow-black/30",
          !data.hasFinances && "lg:col-span-3",
        )}>
          {/* Soft glow behind the hero figure — decorative only, clipped to the card by
              the parent's overflow-hidden so it never bleeds past the rounded corners. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-10 -top-16 size-40 rounded-full opacity-20 blur-3xl"
            style={{ background: pal.recettes }}
          />
          <p className="relative mb-1 text-xs font-medium text-muted-foreground">Cotisations {data.year}</p>
          {/* Hero figure: % already collected — the one number a progress bar exists to
              answer, and distinct from the raw totals already listed below/elsewhere. */}
          <p className="relative mb-4 text-3xl font-semibold">
            {paidPct}<span className="text-lg text-muted-foreground"> % encaissé</span>
          </p>

          <div className="relative flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
            {data.cotisations.map((c, i) => (
              <div
                key={c.status}
                className="animate-bar-grow-in"
                style={{
                  width:           `${cotisationDenom > 0 ? Math.max(((cotisationTotal > 0 ? c.amount : c.count) / cotisationDenom) * 100, 2) : 0}%`,
                  background:      cotisationColor[c.status] ?? pal.axis,
                  boxShadow:       `0 0 8px ${cotisationColor[c.status] ?? pal.axis}88`,
                  animationDelay: `${i * 80}ms`,
                }}
              />
            ))}
          </div>

          <div className="mt-4 space-y-1.5">
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

      {/* Recettes vs Dépenses — trend over time, 2 distinct series → area chart
          (dataviz skill: "trend over time" → line/area; bar is for comparing discrete
          categories, not a continuous monthly progression). */}
      {data.hasFinances && (
        <div className={`rounded-xl border bg-card p-6 dark:border-white/10 dark:shadow-lg dark:shadow-black/30 ${data.hasCotisations ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <p className="mb-4 text-xs font-medium text-muted-foreground">Recettes vs dépenses — 6 derniers mois</p>
          {/* debounce: avoids a known Recharts+ResizeObserver race where the container's
              first reported size is stale/zero — without it the chart can settle into its
              final layout before the mount animation gets a correct size to animate from,
              so it just appears instead of growing in. */}
          <ResponsiveContainer width="100%" height={200} debounce={50}>
            <AreaChart data={data.monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                {/* Wash fill fading to fully transparent — the line itself carries the
                    series color at full strength, the fill is just a soft trend cue. */}
                <linearGradient id="fc-recettes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={pal.recettes} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={pal.recettes} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fc-depenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={pal.depenses} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={pal.depenses} stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* Solid hairline, not dashed — dashing reads as a threshold/projection,
                  not a plain grid (dataviz skill anti-pattern). */}
              <CartesianGrid vertical={false} stroke={pal.grid} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
              <YAxis hide />
              <Tooltip content={<MonthlyTip pal={pal} />} cursor={{ stroke: pal.grid, strokeWidth: 1 }} />
              <Legend
                iconType="plainline"
                wrapperStyle={{ fontSize: 12, color: pal.axis }}
                formatter={(value) => (value === "recettes" ? "Recettes" : "Dépenses")}
              />
              <Area
                type="monotone" dataKey="recettes" name="recettes"
                stroke={pal.recettes} strokeWidth={2} fill="url(#fc-recettes)"
                dot={{ r: 3, fill: pal.recettes, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: pal.recettes, stroke: "var(--card)", strokeWidth: 2 }}
                animationDuration={600} animationEasing="ease-out"
                style={{ filter: `drop-shadow(0 0 4px ${pal.recettes}88)` }}
              />
              <Area
                type="monotone" dataKey="depenses" name="depenses"
                stroke={pal.depenses} strokeWidth={2} fill="url(#fc-depenses)"
                dot={{ r: 3, fill: pal.depenses, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: pal.depenses, stroke: "var(--card)", strokeWidth: 2 }}
                animationDuration={600} animationEasing="ease-out"
                style={{ filter: `drop-shadow(0 0 4px ${pal.depenses}88)` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recettes par catégorie — magnitude ranking → single-hue sequential bar */}
      {data.hasFinances && data.incomeByCategory.length > 0 && (
        <div className="rounded-xl border bg-card p-6 dark:border-white/10 dark:shadow-lg dark:shadow-black/30 lg:col-span-3">
          <p className="mb-4 text-xs font-medium text-muted-foreground">Recettes par catégorie — {data.year}</p>
          <ResponsiveContainer width="100%" height={Math.max(data.incomeByCategory.length * 36, 80)} debounce={50}>
            <BarChart
              data={data.incomeByCategory}
              layout="vertical"
              barSize={20}
              margin={{ top: 0, right: 100, bottom: 0, left: 8 }}
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
              <Bar
                dataKey="amount"
                shape={(props: { x?: number; y?: number; width?: number; height?: number }) => (
                  <LollipopBar {...props} color={pal.sequential} />
                )}
                animationDuration={500} animationEasing="ease-out"
              >
                {/* Default offset assumes a flush bar end — the ring marker extends past
                    that point, so push the label out further to clear it. */}
                <LabelList dataKey="amount" position="right" offset={16} formatter={(v: unknown) => fmt(Number(v))} style={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

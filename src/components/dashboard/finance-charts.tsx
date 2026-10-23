"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend,
  Tooltip, LabelList, ResponsiveContainer,
} from "recharts"
import { useModules } from "@/lib/user-context"
import { usePalette } from "@/lib/finance-palette"

// ─── Types ────────────────────────────────────────────────────────────────────

type FinanceChartsData = {
  year:             number
  hasCotisations:   boolean
  hasFinances:      boolean
  cotisations:      { status: string; count: number; amount: number }[]
  monthly:          { label: string; recettes: number; depenses: number }[]
  incomeByCategory: { name: string; amount: number }[]
}

function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
}

// Figma dashboard mockup: every chart on this page is a blue monochrome ramp, red
// reserved for a genuine alert (overdue) — not the app's validated rainbow categorical
// palette (usePalette, src/lib/finance-palette.ts). Local to this file and this page:
// usePalette is shared with the Finances page's own charts and backoffice/materiel
// charts, which aren't part of this restyle and keep their real categorical colors.
const FIGMA_CHART = {
  blue:      "#023D9D", // primary — darkest step
  blueMid:   "#5C82BE",
  blueLight: "#9EB6DB",
  blueLighter: "#E1E9F5", // lightest step
  red:       "#FF383C", // the one non-blue — alert/overdue only
}

// ─── Tooltips (values lead, series name follows; line-key not a box) ──────────

function MonthlyTip({ active, payload, label }: {
  active?: boolean; label?: string
  payload?: { value: number; dataKey: string }[]
}) {
  const t = useTranslations("dashboard.charts")
  if (!active || !payload?.length) return null
  const recettes = payload.find(p => p.dataKey === "recettes")?.value ?? 0
  const depenses = payload.find(p => p.dataKey === "depenses")?.value ?? 0
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="font-medium">{label}</p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: FIGMA_CHART.blue }} />
        <span className="text-muted-foreground">{t("income")}</span>
        <span className="font-semibold ml-auto">{fmt(recettes)}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: FIGMA_CHART.red }} />
        <span className="text-muted-foreground">{t("expense")}</span>
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

// ─── Components ───────────────────────────────────────────────────────────────

// Cotisations and Recettes/Dépenses used to be one widget rendering its own internal
// `lg:grid-cols-3` — a grid inside the dashboard grid. That made them a single indivisible
// block: neither could be moved or resized without the other, and shrinking the pair left
// the inner grid still asking for three columns. They're two independent widgets now, and
// share this hook so the split still costs exactly one fetch (React Query dedupes the key).
function useFinanceChartsData() {
  const t       = useTranslations()
  const modules = useModules()

  const query = useQuery<FinanceChartsData>({
    queryKey: ["dashboard", "finance-charts"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard/finance-charts")
      if (!res.ok) throw new Error(t("common.error"))
      return res.json()
    },
    enabled:   modules.cotisations || modules.finances,
    staleTime: 5 * 60_000,
  })

  return { ...query, modules }
}

// Cotisations — part-to-whole → stacked bar, never a donut
export function CotisationsGaugeCard() {
  const t   = useTranslations()
  const pal = usePalette()
  const { data, isLoading, modules } = useFinanceChartsData()

  if (!modules.cotisations) return null
  if (isLoading) return <div className="h-full min-h-48 rounded-lg bg-muted/60 animate-pulse" />
  if (!data?.hasCotisations) return null

  const cotisationTotal = data.cotisations.reduce((s, c) => s + c.amount, 0)
  const cotisationCount = data.cotisations.reduce((s, c) => s + c.count, 0)
  // Amount is the natural denominator, but an association where every cotisation is
  // EXONERE (amount 0) would otherwise divide by zero and render a blank bar despite
  // having real data — fall back to splitting by headcount instead.
  const cotisationDenom = cotisationTotal > 0 ? cotisationTotal : cotisationCount
  // ANNULEE deliberately has no slot here — see finance-palette.ts's comment on why a 6th
  // validated categorical hue wasn't feasible, and the server excludes it from this chart's
  // data entirely (consistent with it being excluded from "collectable" amounts elsewhere).
  // Blue ramp (darkest = fully paid) instead of usePalette's categorical hues — only
  // EN_RETARD (genuinely overdue) breaks the ramp with red.
  const cotisationColor: Record<string, string> = {
    PAYE: FIGMA_CHART.blue, PARTIELLEMENT_PAYEE: FIGMA_CHART.blueMid,
    EN_ATTENTE: FIGMA_CHART.blueLight, EXONERE: FIGMA_CHART.blueLighter,
    EN_RETARD: FIGMA_CHART.red,
  }
  const cotisationLabelKey: Record<string, string> = {
    PAYE: "payees", EN_ATTENTE: "enAttente", EXONERE: "exonerees",
    PARTIELLEMENT_PAYEE: "partiellementPayees", EN_RETARD: "enRetard",
  }
  const paidAmount = data.cotisations.find(c => c.status === "PAYE")?.amount ?? 0
  const paidPct    = cotisationTotal > 0 ? Math.round((paidAmount / cotisationTotal) * 100) : 0

  return (
    <div className="relative overflow-hidden rounded-lg bg-muted/60 p-6">
      <p className="relative mb-1 text-base font-medium">{t("dashboard.cotisations.title", { year: data.year })}</p>
      {/* Hero figure: % already collected — the one number a progress bar exists to
          answer, and distinct from the raw totals already listed below/elsewhere. */}
      <p className="relative mb-4 text-sm font-medium text-muted-foreground">
        {paidPct}{t("dashboard.charts.collectedPercent")}
      </p>

      <div className="relative flex h-10 w-full gap-px overflow-hidden rounded-lg">
        {data.cotisations.map((c, i) => (
          <div
            key={c.status}
            className="animate-bar-grow-in"
            style={{
              width:           `${cotisationDenom > 0 ? Math.max(((cotisationTotal > 0 ? c.amount : c.count) / cotisationDenom) * 100, 2) : 0}%`,
              background:      cotisationColor[c.status] ?? pal.axis,
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
              <span className="text-muted-foreground">
                {t(`cotisations.view.statusFilter.${cotisationLabelKey[c.status] ?? c.status}`)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-muted-foreground">{c.count}</span>
              <span className="w-20 text-right tabular-nums font-medium">{fmt(c.amount)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Recettes vs Dépenses — smooth curved area chart, matching the Figma dashboard
// mockup's own chart exactly (confirmed from its exported overlay SVG: two monotone
// lines with a gradient fill fading to transparent, blue for paid/income, red for
// pending/expense) — not the grouped-bar version this briefly became.
export function IncomeExpenseChart() {
  const t   = useTranslations()
  const pal = usePalette()
  const { data, isLoading, modules } = useFinanceChartsData()

  if (!modules.finances) return null
  if (isLoading) return <div className="h-full min-h-48 rounded-lg bg-muted/60 animate-pulse" />
  if (!data?.hasFinances) return null

  return (
    <div className="flex h-full flex-col rounded-lg bg-muted/60 p-6">
      <p className="mb-4 shrink-0 text-base font-medium">{t("dashboard.charts.trendTitle")}</p>
      {/* Fills whatever height the widget was resized to, instead of the fixed 200px it
          used when the card's height wasn't the user's to choose. */}
      <div className="min-h-0 flex-1">
        {/* debounce: avoids a known Recharts+ResizeObserver race where the container's
            first reported size is stale/zero — without it the chart can settle into its
            final layout before the mount animation gets a correct size to animate from,
            so it just appears instead of growing in. */}
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <AreaChart data={data.monthly} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              {/* Wash fill fading to fully transparent — the line itself carries the
                  series color at full strength, the fill is just a soft trend cue. */}
              <linearGradient id="fc-recettes" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor={FIGMA_CHART.blue} stopOpacity={0.35} />
                <stop offset="100%" stopColor={FIGMA_CHART.blue} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fc-depenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor={FIGMA_CHART.red} stopOpacity={0.35} />
                <stop offset="100%" stopColor={FIGMA_CHART.red} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={pal.grid} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} width={32} />
            <Tooltip content={<MonthlyTip />} cursor={{ stroke: pal.grid, strokeWidth: 1 }} />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: pal.axis }}
              formatter={(value) => (value === "recettes" ? t("dashboard.charts.income") : t("dashboard.charts.expense"))}
            />
            <Area
              type="monotone" dataKey="recettes" name="recettes"
              stroke={FIGMA_CHART.blue} strokeWidth={2} fill="url(#fc-recettes)"
              dot={{ r: 3, fill: FIGMA_CHART.blue, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: FIGMA_CHART.blue, stroke: "var(--card)", strokeWidth: 2 }}
              animationDuration={600} animationEasing="ease-out"
            />
            <Area
              type="monotone" dataKey="depenses" name="depenses"
              stroke={FIGMA_CHART.red} strokeWidth={2} fill="url(#fc-depenses)"
              dot={{ r: 3, fill: FIGMA_CHART.red, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: FIGMA_CHART.red, stroke: "var(--card)", strokeWidth: 2 }}
              animationDuration={600} animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Split out from the grid above so the dashboard's left column (Prochain événement +
// Cotisations) can place it right below Cotisations instead of leaving that column
// visibly shorter than the right one — same underlying query (shared cache entry via
// the identical queryKey, so this doesn't cost a second request).
export function IncomeByCategoryChart() {
  const t   = useTranslations()
  const pal = usePalette()
  const { data, isLoading } = useQuery<FinanceChartsData>({
    queryKey: ["dashboard", "finance-charts"],
    queryFn:  async () => {
      const res = await fetch("/api/dashboard/finance-charts")
      if (!res.ok) throw new Error(t("common.error"))
      return res.json()
    },
    staleTime: 5 * 60_000,
  })

  if (isLoading) return <div className="h-48 rounded-lg bg-muted/60 animate-pulse" />
  if (!data || !data.hasFinances || data.incomeByCategory.length === 0) return null

  return (
    <div className="rounded-lg bg-muted/60 p-6">
      <p className="mb-4 text-base font-medium">{t("dashboard.charts.categoryTitle", { year: data.year })}</p>
      <ResponsiveContainer width="100%" height={220} debounce={50}>
        <BarChart data={data.incomeByCategory} margin={{ top: 24, right: 8, bottom: 0, left: 8 }} barCategoryGap="24%">
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: pal.axis, fontFamily: "inherit" }} />
          <YAxis hide />
          <Tooltip content={<CategoryTip />} cursor={{ fill: pal.cursor }} />
          <Bar dataKey="amount" fill={pal.sequential} radius={[8, 8, 0, 0]} animationDuration={500} animationEasing="ease-out">
            {/* White, inside the bar near its top — reads against the solid fill
                instead of needing room for an external label at every bar height. */}
            <LabelList dataKey="amount" position="insideTop" offset={10} formatter={(v: unknown) => fmt(Number(v))} style={{ fontSize: 11, fill: "#fff", fontFamily: "inherit" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

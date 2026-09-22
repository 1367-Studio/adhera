"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip, ResponsiveContainer,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePalette } from "@/lib/finance-palette"

type FaturamentoData = {
  year:        number
  currentYear: number
  firstYear:   number
  months:      { month: number; netCents: number; hasData: boolean }[]
}

type ChartPoint = {
  label:     string
  total:     number | null
  isCurrent: boolean
}

const MONTH_LABELS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."]

function formatEuroAmount(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount)
}

function formatEuros(cents: number): string {
  return formatEuroAmount(cents / 100)
}

function RevenueTip({ active, payload }: {
  active?:  boolean
  payload?: { value: number | null; payload: ChartPoint }[]
}) {
  if (!active || !payload?.length || payload[0].value == null) return null
  const { value, payload: point } = payload[0]
  // `value` here is chartData's `total`, already converted to euros — formatEuros expects
  // cents and would divide by 100 a second time (a real bug: 728,80€ rendered as "7,29 €").
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{point.label}{point.isCurrent ? " (partiel)" : ""}</p>
      <p className="font-semibold">{formatEuroAmount(value)}</p>
    </div>
  )
}

export function RevenueChart() {
  const pal = usePalette()
  const [year, setYear] = useState(new Date().getFullYear())

  const { data, isLoading, isError, refetch } = useQuery<FaturamentoData>({
    queryKey: ["backoffice", "faturamento", year],
    queryFn:  async () => {
      const res = await fetch(`/api/backoffice/faturamento?year=${year}`)
      if (!res.ok) throw new Error("Erreur de chargement")
      return res.json()
    },
    staleTime: 60_000,
  })

  // The API is the source of truth for which year actually got queried (it clamps an
  // out-of-range value back to `currentYear`) — deriving the displayed year from the response
  // rather than trusting local state back means the dropdown can never show one year's label
  // over another year's numbers, even for the one request made before data has loaded.
  const displayYear = data?.year ?? year

  // Before the first response, the real [firstYear, currentYear] bound isn't known yet — offer
  // just the guessed current year rather than a hard-coded window that could silently omit or
  // over-offer years relative to what the API will actually accept.
  const yearOptions = data
    ? Array.from({ length: data.currentYear - data.firstYear + 1 }, (_, i) => data.currentYear - i)
    : [year]

  // While the selected year is still the current year, its last queried month is necessarily
  // "now" — not a finished month — so its point represents a partial period, not a real dip.
  const isCurrentYear     = data ? data.year === data.currentYear : false
  const partialMonth      = isCurrentYear ? [...(data?.months ?? [])].reverse().find(m => m.hasData)?.month : undefined

  const chartData: ChartPoint[] | undefined = data?.months.map(m => ({
    label:     MONTH_LABELS[m.month - 1],
    total:     m.hasData ? m.netCents / 100 : null,
    isCurrent: m.month === partialMonth,
  }))

  const yearTotalCents = data?.months.reduce((sum, m) => sum + (m.hasData ? m.netCents : 0), 0) ?? 0
  const isEmpty = !isLoading && !isError && !!data && yearTotalCents === 0

  return (
    <div className="rounded-lg border bg-card p-6 dark:border-white/10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Chiffre d&apos;affaires</p>
          {!isLoading && !isError && data && (
            <p className="mt-1 text-lg font-semibold">{formatEuros(yearTotalCents)}</p>
          )}
        </div>
        <Select value={String(displayYear)} onValueChange={v => v && setYear(Number(v))}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-muted" />}

      {!isLoading && isError && (
        <div className="flex h-40 flex-col items-center justify-center gap-2">
          <p className="text-xs text-muted-foreground">Impossible de charger les données Stripe.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Réessayer</Button>
        </div>
      )}

      {!isLoading && !isError && isEmpty && (
        <p className="flex h-40 items-center justify-center text-center text-xs text-muted-foreground">
          Aucun mouvement financier enregistré sur {displayYear}.
        </p>
      )}

      {!isLoading && !isError && !isEmpty && chartData && (
        <>
          <ResponsiveContainer width="100%" height={200} debounce={50}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={pal.grid} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }}
              />
              {/* Domain forced through 0 (rather than recharts' default data-min/data-max) so the
                  dashed reference line below is always a meaningful baseline — a month where
                  refunds outweighed income shows as a real dip below it, not just a low point. */}
              <YAxis hide domain={[(min: number) => Math.min(min, 0), (max: number) => Math.max(max, 0)]} />
              <ReferenceLine y={0} stroke={pal.grid} strokeDasharray="3 3" />
              <Tooltip content={<RevenueTip />} cursor={{ stroke: pal.grid, strokeWidth: 1 }} />
              <Line
                type="monotone" dataKey="total" connectNulls={false}
                stroke={pal.recettes} strokeWidth={2}
                dot={(props: { cx?: number; cy?: number; payload: ChartPoint }) => {
                  const { cx, cy, payload } = props
                  if (payload.total == null || cx == null || cy == null) return <g key={payload.label} />
                  // Hollow ring for the in-progress month instead of the usual filled dot — a
                  // quiet visual cue that this point isn't a finished month like the others.
                  return payload.isCurrent
                    ? <circle key={payload.label} cx={cx} cy={cy} r={4} fill="var(--card)" stroke={pal.recettes} strokeWidth={2} />
                    : <circle key={payload.label} cx={cx} cy={cy} r={3} fill={pal.recettes} />
                }}
                activeDot={{ r: 4, fill: pal.recettes, stroke: "var(--card)", strokeWidth: 2 }}
                animationDuration={500} animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
          {partialMonth && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {MONTH_LABELS[partialMonth - 1]} en cours — données partielles.
            </p>
          )}
        </>
      )}
    </div>
  )
}

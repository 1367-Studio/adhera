"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart, Bar, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList, ResponsiveContainer,
} from "recharts"
import { Button } from "@/components/ui/button"
import { usePalette } from "@/lib/finance-palette"

type RecentAdhesionsData = {
  days:          number
  paidOnly:      boolean
  associations:  { id: string; name: string; count: number }[]
  daily:         { date: string; count: number }[]
}

const WINDOW_OPTIONS = [7, 30, 90] as const

// "2026-09-19" -> "19/09", string-sliced rather than parsed through Date to avoid any
// timezone shift moving the label onto the wrong day.
function formatDay(dateStr: string): string {
  const [, month, day] = dateStr.split("-")
  return `${day}/${month}`
}

function AssociationTip({ active, payload }: {
  active?:  boolean
  payload?: { value: number; payload: { name: string } }[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="font-semibold">{payload[0].value} adhésion{payload[0].value > 1 ? "s" : ""}</p>
    </div>
  )
}

function TrendTip({ active, payload }: {
  active?:  boolean
  payload?: { value: number; payload: { date: string } }[]
}) {
  if (!active || !payload?.length) return null
  const { value, payload: point } = payload[0]
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{formatDay(point.date)}</p>
      <p className="font-semibold">{value} adhésion{value > 1 ? "s" : ""}</p>
    </div>
  )
}

export function RecentAdhesionsChart() {
  const pal = usePalette()
  const [days, setDays] = useState<typeof WINDOW_OPTIONS[number]>(30)
  const [paidOnly, setPaidOnly] = useState(false)

  const { data, isLoading } = useQuery<RecentAdhesionsData>({
    queryKey: ["backoffice", "adhesoes-recentes", days, paidOnly],
    queryFn:  async () => {
      const res = await fetch(`/api/backoffice/adhesoes-recentes?days=${days}&paidOnly=${paidOnly ? "1" : "0"}`)
      if (!res.ok) throw new Error("Erreur de chargement")
      return res.json()
    },
    staleTime: 60_000,
  })

  const hasData = !!data && data.associations.length > 0
  // Thins x-axis ticks so a 90-day window doesn't try to cram 90 labels — always shows
  // roughly 8 regardless of the selected period.
  const tickInterval = data ? Math.max(Math.ceil(data.daily.length / 8) - 1, 0) : 0

  return (
    <div className="rounded-lg border bg-card p-6 dark:border-white/10">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Adhésions récentes</p>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <Button size="sm" variant={!paidOnly ? "default" : "outline"} onClick={() => setPaidOnly(false)}>
              Tous
            </Button>
            <Button size="sm" variant={paidOnly ? "default" : "outline"} onClick={() => setPaidOnly(true)}>
              Payants
            </Button>
          </div>
          <div className="flex gap-1">
            {WINDOW_OPTIONS.map(option => (
              <Button
                key={option}
                size="sm"
                variant={days === option ? "default" : "outline"}
                onClick={() => setDays(option)}
              >
                {option}j
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="h-32 animate-pulse rounded-lg bg-muted" />}

      {!isLoading && !hasData && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Aucune nouvelle adhésion{paidOnly ? " payante" : ""} sur les {days} derniers jours.
        </p>
      )}

      {!isLoading && data && hasData && (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground">Total quotidien, toutes associations</p>
            <ResponsiveContainer width="100%" height={160} debounce={50}>
              {/* left:16 — otherwise the first x-axis tick's label (centered on the plot's
                  own left edge) gets half-clipped by the container. */}
              <AreaChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: 16 }}>
                <defs>
                  <linearGradient id="adhesions-trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor={pal.sequential} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={pal.sequential} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={pal.grid} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  interval={tickInterval}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }}
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<TrendTip />} cursor={{ stroke: pal.grid, strokeWidth: 1 }} />
                <Area
                  type="monotone" dataKey="count"
                  stroke={pal.sequential} strokeWidth={2} fill="url(#adhesions-trend-fill)"
                  dot={false}
                  activeDot={{ r: 4, fill: pal.sequential, stroke: "var(--card)", strokeWidth: 2 }}
                  animationDuration={500} animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div>
            <p className="mb-2 text-[11px] text-muted-foreground">Par association</p>
            <ResponsiveContainer width="100%" height={Math.max(data.associations.length * 36, 80)} debounce={50}>
              <BarChart
                data={data.associations}
                layout="vertical"
                barSize={20}
                margin={{ top: 0, right: 24, bottom: 0, left: 8 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: pal.axis, fontFamily: "inherit" }}
                  width={160}
                />
                <Tooltip content={<AssociationTip />} cursor={{ fill: pal.cursor }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={500} animationEasing="ease-out">
                  {/* Only the top result (the association with the most recent adhésions)
                      gets the accent color — everything else stays a muted neutral, so
                      the one association worth a second look is the one that stands out. */}
                  {data.associations.map((a, i) => (
                    <Cell key={a.id} fill={i === 0 ? pal.sequential : pal.axis} />
                  ))}
                  {/* Inside the bar, not after it — the top bar's value can equal (or sit
                      close to) the chart's own domain max, which would push an
                      after-the-bar label past the visible plot area. */}
                  <LabelList dataKey="count" position="insideRight" offset={8} style={{ fontSize: 11, fill: "#fff", fontFamily: "inherit", fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

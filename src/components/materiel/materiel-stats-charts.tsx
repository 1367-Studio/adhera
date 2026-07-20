"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, ResponsiveContainer } from "recharts"
import { usePalette } from "@/lib/finance-palette"
import { useMaterielStats } from "@/hooks/use-materiel"

function fmtEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
}

function CountTip({ active, payload }: { active?: boolean; payload?: { value: number; payload: { name: string } }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="font-semibold">{payload[0].value} prêt{payload[0].value > 1 ? "s" : ""}</p>
    </div>
  )
}

function AmountTip({ active, payload }: { active?: boolean; payload?: { value: number; payload: { name: string } }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{payload[0].payload.name}</p>
      <p className="font-semibold">{fmtEUR(payload[0].value)}</p>
    </div>
  )
}

// Lollipop mark, matching finance-charts.tsx's convention for magnitude-ranking bars.
function LollipopBar({ x, y, width, height, color }: { x?: number; y?: number; width?: number; height?: number; color: string }) {
  if (x == null || y == null || width == null || height == null) return null
  const cy     = y + height / 2
  const outerR = Math.min(height / 2 + 1, 9)
  const innerR = outerR * 0.45
  const x2     = Math.max(x + width - outerR, x)
  return (
    <g style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}>
      <line x1={x} y1={cy} x2={x2} y2={cy} stroke={color} strokeWidth={6} strokeLinecap="round" />
      <circle cx={x + width} cy={cy} r={outerR} fill="var(--card)" stroke={color} strokeWidth={2} />
      <circle cx={x + width} cy={cy} r={innerR} fill={color} />
    </g>
  )
}

export function MaterielStatsCharts() {
  const { data, isLoading } = useMaterielStats()
  const pal = usePalette()

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-xl border bg-card animate-pulse" />
        <div className="h-48 rounded-xl border bg-card animate-pulse" />
      </div>
    )
  }

  if (!data || (data.topLoaned.length === 0 && data.revenueByMaterial.length === 0)) return null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.topLoaned.length > 0 && (
        <div className="rounded-xl border bg-card p-6 dark:border-white/10 dark:shadow-lg dark:shadow-black/30">
          <p className="mb-4 text-xs font-medium text-muted-foreground">Matériels les plus prêtés</p>
          <ResponsiveContainer width="100%" height={Math.max(data.topLoaned.length * 32, 80)} debounce={50}>
            <BarChart data={data.topLoaned} layout="vertical" barSize={16} margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: pal.axis, fontFamily: "inherit" }} width={140} />
              <Tooltip content={<CountTip />} cursor={{ fill: pal.cursor }} />
              <Bar
                dataKey="count"
                shape={(props: { x?: number; y?: number; width?: number; height?: number }) => <LollipopBar {...props} color={pal.sequential} />}
                animationDuration={500} animationEasing="ease-out"
              >
                <LabelList dataKey="count" position="right" offset={16} style={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.revenueByMaterial.length > 0 && (
        <div className="rounded-xl border bg-card p-6 dark:border-white/10 dark:shadow-lg dark:shadow-black/30">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Montant récolté par matériel</p>
          <p className="mb-3 text-lg font-semibold">{fmtEUR(data.totalRevenue)} <span className="text-xs font-normal text-muted-foreground">au total</span></p>
          <ResponsiveContainer width="100%" height={Math.max(data.revenueByMaterial.length * 32, 80)} debounce={50}>
            <BarChart data={data.revenueByMaterial} layout="vertical" barSize={16} margin={{ top: 0, right: 70, bottom: 0, left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: pal.axis, fontFamily: "inherit" }} width={140} />
              <Tooltip content={<AmountTip />} cursor={{ fill: pal.cursor }} />
              <Bar
                dataKey="amount"
                shape={(props: { x?: number; y?: number; width?: number; height?: number }) => <LollipopBar {...props} color={pal.recettes} />}
                animationDuration={500} animationEasing="ease-out"
              >
                <LabelList dataKey="amount" position="right" offset={16} formatter={(v: unknown) => fmtEUR(Number(v))} style={{ fontSize: 11, fill: pal.axis, fontFamily: "inherit" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

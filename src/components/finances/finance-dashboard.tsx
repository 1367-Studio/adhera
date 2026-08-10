"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Stats = {
  totalIncomes:     number
  totalExpenses:    number
  result:           number
  cumulativeResult: number
  unmatched:        number
  pendingReceipts:  number
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

function sumAmount(data: unknown): number {
  const rows = (data as { data?: unknown[] })?.data ?? (Array.isArray(data) ? data : [])
  return (rows as { amount: string | number }[]).reduce((s, r) => s + Number(r.amount), 0)
}

async function fetchStats(year: number): Promise<Stats> {
  const dateFrom = `${year}-01-01`
  const dateTo   = `${year}-12-31`
  const incParams = new URLSearchParams({ dateFrom, dateTo, status: "PAID" })
  const expParams = new URLSearchParams({ dateFrom, dateTo, status: "VALIDATED" })
  const [incRes, expRes, txRes, expPendRes, incAllRes, expAllRes] = await Promise.all([
    fetch(`/api/finances/incomes?${incParams}`),
    fetch(`/api/finances/expenses?${expParams}`),
    fetch("/api/finances/transactions?status=UNMATCHED&limit=1"),
    fetch("/api/finances/expenses?status=DRAFT&limit=1"),
    fetch("/api/finances/incomes?status=PAID"),
    fetch("/api/finances/expenses?status=VALIDATED"),
  ])
  const [incData, expData, txData, pendData, incAllData, expAllData] = await Promise.all([
    incRes.json(), expRes.json(), txRes.json(), expPendRes.json(), incAllRes.json(), expAllRes.json(),
  ])

  const totalIncomes  = sumAmount(incData)
  const totalExpenses = sumAmount(expData)

  return {
    totalIncomes,
    totalExpenses,
    result:           totalIncomes - totalExpenses,
    cumulativeResult: sumAmount(incAllData) - sumAmount(expAllData),
    unmatched:        txData.total   ?? 0,
    pendingReceipts:  pendData.total ?? 0,
  }
}

// Key figures as plain typography (CLAUDE.md §8): label over value, no card per statistic,
// no icon tiles, no per-metric color families — only negative values get the destructive color.
function StatItem({ title, value, prefix = "" }: {
  title:   string
  value:   number
  prefix?: string
}) {
  const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{title}</dt>
      <dd className={cn("mt-1 text-xl font-semibold tabular-nums", value < 0 && "text-destructive")}>
        {prefix}{fmt(value)}
      </dd>
    </div>
  )
}

function CountItem({ title, value, label }: {
  title: string
  value: number
  label: string
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{title}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </dd>
    </div>
  )
}

export function FinanceDashboard() {
  const t = useTranslations("finances.dashboard")
  const [year, setYear] = useState(currentYear)

  const { data: stats, isLoading } = useQuery({
    queryKey:  ["finances-stats", year],
    queryFn:   () => fetchStats(year),
    staleTime: 0,
  })

  const s = stats ?? { totalIncomes: 0, totalExpenses: 0, result: 0, cumulativeResult: 0, unmatched: 0, pendingReceipts: 0 }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          <Select value={String(year)} onValueChange={v => setYear(parseInt(v ?? String(year)))}>
            <SelectTrigger className="w-36"><SelectValue>{t("exercise", { year })}</SelectValue></SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{t("exercise", { year: y })}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-3">
          <StatItem title={t("incomeCard", { year })} value={s.totalIncomes} prefix="+" />
          <StatItem title={t("expensesCard", { year })} value={-s.totalExpenses} />
          <StatItem title={t("resultCard", { year })} value={s.result} prefix={s.result >= 0 ? "+" : ""} />
          <StatItem title={t("cumulativeResultCard")} value={s.cumulativeResult} prefix={s.cumulativeResult >= 0 ? "+" : ""} />
          <CountItem title={t("unmatchedTitle")} value={s.unmatched} label={t("unmatchedLabel")} />
          <CountItem title={t("pendingReceiptsTitle")} value={s.pendingReceipts} label={t("pendingReceiptsLabel")} />
        </dl>
      )}
    </div>
  )
}

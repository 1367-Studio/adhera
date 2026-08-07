"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { TrendUpIcon, TrendDownIcon, BankIcon, ScalesIcon, WarningCircleIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
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

function StatCard({ title, value, icon: Icon, colorClass, prefix = "" }: {
  title:      string
  value:      number
  icon:       React.ElementType
  colorClass: string
  prefix?:    string
}) {
  const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{title}</span>
        <div className={cn("flex size-7 items-center justify-center rounded-lg", colorClass)}>
          <Icon className="size-3.5" />
        </div>
      </div>
      <span className={cn("text-xl font-bold tabular-nums", value >= 0 ? "" : "text-destructive")}>
        {prefix}{fmt(value)}
      </span>
    </div>
  )
}

function CountCard({ title, value, icon: Icon, colorClass, label }: {
  title:      string
  value:      number
  icon:       React.ElementType
  colorClass: string
  label:      string
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{title}</span>
        <div className={cn("flex size-7 items-center justify-center rounded-lg", colorClass)}>
          <Icon className="size-3.5" />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
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
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 h-24 animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard title={t("incomeCard", { year })} value={s.totalIncomes}  icon={TrendUpIcon}   colorClass="bg-green-50 dark:bg-green-950/30" prefix="+" />
          <StatCard title={t("expensesCard", { year })} value={-s.totalExpenses} icon={TrendDownIcon} colorClass="bg-red-50 dark:bg-red-950/30" />
          <StatCard
            title={t("resultCard", { year })}
            value={s.result}
            icon={ScalesIcon}
            colorClass={s.result >= 0 ? "bg-green-50 dark:bg-green-950/30" : "bg-red-50 dark:bg-red-950/30"}
            prefix={s.result >= 0 ? "+" : ""}
          />
          <StatCard
            title={t("cumulativeResultCard")}
            value={s.cumulativeResult}
            icon={BankIcon}
            colorClass="bg-blue-50 dark:bg-blue-950/30"
            prefix={s.cumulativeResult >= 0 ? "+" : ""}
          />
          <CountCard title={t("unmatchedTitle")} value={s.unmatched}       icon={WarningCircleIcon} colorClass="bg-orange-50 dark:bg-orange-950/30" label={t("unmatchedLabel")} />
          <CountCard title={t("pendingReceiptsTitle")}    value={s.pendingReceipts} icon={ReceiptIcon}     colorClass="bg-yellow-50 dark:bg-yellow-950/30" label={t("pendingReceiptsLabel")} />
        </div>
      )}
    </div>
  )
}

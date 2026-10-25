"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  TrendUpIcon, TrendDownIcon, ScalesIcon, PiggyBankIcon, ArrowsLeftRightIcon, ReceiptIcon,
} from "@phosphor-icons/react/dist/ssr"
import { StatTile } from "@/components/dashboard/widgets/stat-tile"

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

// Signed amount: "+" on gains, the minus sign from toLocaleString on losses.
function formatSignedEuros(amount: number, showPlusSign: boolean): string {
  const formattedAmount = amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  return showPlusSign && amount >= 0 ? `+${formattedAmount}` : formattedAmount
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

      {/* Same StatTile as the dashboard home, Dons and Boutique — each tile opens the page
          where that figure is worked on. Only negative amounts take a color (destructive). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={t("incomeCard", { year })}
          value={formatSignedEuros(s.totalIncomes, true)}
          icon={TrendUpIcon}
          href="/dashboard/finances/recettes"
          isLoading={isLoading}
        />
        <StatTile
          label={t("expensesCard", { year })}
          value={formatSignedEuros(-s.totalExpenses, false)}
          icon={TrendDownIcon}
          href="/dashboard/finances/depenses"
          isNegative={s.totalExpenses > 0}
          isLoading={isLoading}
        />
        <StatTile
          label={t("resultCard", { year })}
          value={formatSignedEuros(s.result, true)}
          icon={ScalesIcon}
          href="/dashboard/finances/rapports/compte-de-resultat"
          isNegative={s.result < 0}
          isLoading={isLoading}
        />
        <StatTile
          label={t("cumulativeResultCard")}
          value={formatSignedEuros(s.cumulativeResult, true)}
          icon={PiggyBankIcon}
          href="/dashboard/finances/rapports/bilan"
          isNegative={s.cumulativeResult < 0}
          isLoading={isLoading}
        />
        <StatTile
          label={t("unmatchedTitle")}
          value={s.unmatched}
          detail={t("unmatchedLabel")}
          icon={ArrowsLeftRightIcon}
          href="/dashboard/finances/conciliation"
          isLoading={isLoading}
        />
        <StatTile
          label={t("pendingReceiptsTitle")}
          value={s.pendingReceipts}
          detail={t("pendingReceiptsLabel")}
          icon={ReceiptIcon}
          href="/dashboard/finances/depenses"
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}

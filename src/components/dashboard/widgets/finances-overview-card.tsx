"use client"

import { BankIcon, HeartIcon } from "@phosphor-icons/react/dist/ssr"
import { usePalette } from "@/lib/finance-palette"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  useFinanceChartsData, IncomeExpenseChart, IncomeByCategoryChart, fmt,
} from "@/components/dashboard/finance-charts"

interface Props {
  solde:     number | null
  donsRecus: number | null
  isLoading: boolean
}

// Merges stat-solde, stat-dons, income-expense-chart and income-by-category into one widget
// (FORM-120): mini-stats on top, the two charts side by side below when width allows. Solde
// and Dons reçus keep their own distinct scopes/labels from the charts below them — solde and
// "dons reçus" come from the association's own Income/Don tables, while "Recettes par
// catégorie" is a broader accounting breakdown that can include non-Don income tagged to a
// "dons" category (see category-resolution.ts) — never presented as the same figure.
export function FinancesOverviewCard({ solde, donsRecus, isLoading }: Props) {
  const t   = useTranslations("dashboard.stats")
  const pal = usePalette()
  const { data: chartData, isLoading: chartLoading, modules } = useFinanceChartsData()

  if (!modules.finances) return null

  const loading = isLoading || chartLoading
  const soldePositive = solde === null || solde >= 0

  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-6">
      {loading ? (
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      ) : (
        <>
          <div className={cn("grid grid-cols-1 gap-4", donsRecus !== null && "sm:grid-cols-2")}>
            <div className="rounded-lg bg-background/60 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <BankIcon className="size-4" />
                <span className="text-xs font-medium">{t("financialBalance")}</span>
              </div>
              <p
                className="mt-1 text-xl font-bold tabular-nums"
                style={{ color: soldePositive ? pal.recettes : pal.depenses }}
              >
                {solde !== null ? fmt(solde) : "—"}
              </p>
            </div>
            {/* Hidden rather than shown as "—": donsRecus is null specifically when the user
                lacks "dons" read access (see /api/dashboard), not when the figure is 0 — an
                empty box here would misread as "no donations" rather than "not your data". */}
            {donsRecus !== null && (
              <div className="rounded-lg bg-background/60 p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <HeartIcon className="size-4" />
                  <span className="text-xs font-medium">{t("donationsReceived", { year: new Date().getFullYear() })}</span>
                </div>
                <p className="mt-1 text-xl font-bold tabular-nums">{fmt(donsRecus)}</p>
              </div>
            )}
          </div>

          {chartData?.hasFinances && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {chartData.incomeByCategory.length > 0 && <IncomeByCategoryChart data={chartData} />}
              {/* Spans both columns when it's the only chart rendering (no category data yet)
                  — otherwise it sat in just the left column, leaving the right half of the
                  row visibly blank on wide screens. */}
              <IncomeExpenseChart data={chartData} className={chartData.incomeByCategory.length === 0 ? "lg:col-span-2" : undefined} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

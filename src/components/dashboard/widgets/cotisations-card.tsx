"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { TrendUpIcon } from "@phosphor-icons/react/dist/ssr"
import { PENDING_COTISATION_STATUSES } from "@/lib/cotisation-filters"
import { useFinanceChartsData, CotisationsGaugeContent } from "@/components/dashboard/finance-charts"

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

interface Props {
  cotisationsEncaissees:      number
  cotisationsEnAttente:       number
  cotisationsResteAPercevoir: number
  isLoading: boolean
}

// Merges the former stat-cotisations tile, cotisations-summary card and cotisations-gauge
// chart into one widget (FORM-120): exercice, montant encaissé, reste à percevoir, nombre en
// attente, and the per-status progression bar — all in a single card instead of three.
export function CotisationsCard({ cotisationsEncaissees, cotisationsEnAttente, cotisationsResteAPercevoir, isLoading }: Props) {
  const t    = useTranslations("dashboard.cotisations")
  const year = new Date().getFullYear()
  const { data: chartData, isLoading: chartLoading, modules } = useFinanceChartsData()

  if (!modules.cotisations) return null

  const loading = isLoading || chartLoading

  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <TrendUpIcon className="size-4.5 text-muted-foreground" />
        <span className="text-base font-medium">{t("title", { year })}</span>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-2xl font-bold tabular-nums">{fmt(cotisationsEncaissees)}</p>
            <p className="text-xs text-muted-foreground">{t("collectedThisYear")}</p>
            <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
              <span>{t("remaining", { amount: fmt(cotisationsResteAPercevoir) })}</span>
              {cotisationsEnAttente > 0 && (
                <Link
                  href={`/dashboard/cotisations?status=${PENDING_COTISATION_STATUSES}`}
                  className="hover:underline"
                >
                  {t("pendingPayment", { count: cotisationsEnAttente })}
                </Link>
              )}
            </div>
          </div>

          {chartData?.hasCotisations && <CotisationsGaugeContent data={chartData} formatAmount={fmt} />}

          <Link href="/dashboard/cotisations" className="text-xs text-muted-foreground hover:underline block pt-1">
            {t("viewAll")}
          </Link>
        </>
      )}
    </div>
  )
}

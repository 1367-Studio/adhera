"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { TrendUpIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { usePalette } from "@/lib/finance-palette"

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

interface Props {
  cotisationsEncaissees: number
  cotisationsEnAttente:  number
  isLoading: boolean
}

export function CotisationsSummaryCard({ cotisationsEncaissees, cotisationsEnAttente, isLoading }: Props) {
  const t   = useTranslations("dashboard.cotisations")
  const pal = usePalette()
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <TrendUpIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("title", { year: new Date().getFullYear() })}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : (
        <div className="space-y-1">
          <p className="text-2xl font-bold tabular-nums" style={{ color: pal.payees }}>
            {fmt(cotisationsEncaissees)}
          </p>
          <p className="text-xs text-muted-foreground">{t("collectedThisYear")}</p>
          {cotisationsEnAttente > 0 && (
            <Link
              href="/dashboard/cotisations"
              className="text-xs hover:underline flex items-center gap-1 mt-1"
              style={{ color: pal.enAttente }}
            >
              <WarningCircleIcon className="size-3" />
              {t("pendingPayment", { count: cotisationsEnAttente })}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

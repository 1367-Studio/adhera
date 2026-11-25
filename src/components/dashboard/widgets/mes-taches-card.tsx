"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { CheckSquareIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"

interface Props {
  count:     number
  isLoading: boolean
}

export function MesTachesCard({ count, isLoading }: Props) {
  const t = useTranslations("dashboard.mesTaches")
  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-3">
      <div className="flex items-center gap-2">
        <CheckSquareIcon className="size-4.5 text-muted-foreground" />
        <span className="text-base font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : (
        <div className="space-y-2">
          <p className="text-[1.75rem] leading-none font-medium tabular-nums">{count}</p>
          <p className="text-sm text-muted-foreground">
            {count === 0 ? t("empty") : t("openCount", { count })}
          </p>
          <Link href="/dashboard/taches" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            {t("viewAll")} <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}

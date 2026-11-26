"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { UsersIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { useIsAdministrator } from "@/lib/user-context"
import { memberUsageLevel, memberUsagePercent, type MemberUsageLevel } from "@/lib/member-usage"

const BILLING_SETTINGS_PATH = "/dashboard/parametres?tab=abonnement"

type MemberUsage = { activeCount: number; limit: number }

const BAR_FILL_CLASS: Record<MemberUsageLevel, string> = {
  normal:   "bg-primary",
  warning:  "bg-warning",
  critical: "bg-destructive",
}

const LEVEL_TEXT_CLASS: Record<MemberUsageLevel, string> = {
  normal:   "text-muted-foreground",
  warning:  "text-warning",
  critical: "text-destructive",
}

interface Props {
  totalCount:  number | null
  activeCount: number | null
  isLoading:   boolean
}

// Widget version of the former standalone <MemberSummary> (member-summary.tsx, now removed)
// — FORM-120 folds "actifs/total/inactifs + jauge de capacité" into one card inside the
// widget grid (drag/resize/visibility like every other widget) instead of a flat row always
// pinned above it. Same data, same /api/dashboard/member-usage query (own query so a Stripe
// hiccup only blanks the bar, not the whole card).
export function MembresSummaryCard({ totalCount, activeCount, isLoading }: Props) {
  const t = useTranslations("dashboard.memberSummary")

  const { data: usage } = useQuery<MemberUsage>({
    queryKey:  ["dashboard", "member-usage"],
    staleTime: 5 * 60 * 1000,
    queryFn:   async () => {
      const response = await fetch("/api/dashboard/member-usage")
      if (!response.ok) throw new Error("member-usage")
      return response.json()
    },
  })

  const hasCounts = totalCount != null && activeCount != null

  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-3">
      <div className="flex items-center gap-2">
        <UsersIcon className="size-4.5 text-muted-foreground" />
        <span className="text-base font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            {hasCounts ? (
              <>
                <span className="font-medium text-foreground">{t("active", { count: activeCount })}</span>
                {" · "}{t("total", { count: totalCount })}
                {" · "}{t("inactive", { count: Math.max(0, totalCount! - activeCount!) })}
              </>
            ) : "…"}
          </p>
          {usage && <MemberUsageBar activeCount={usage.activeCount} limit={usage.limit} />}
        </div>
      )}
    </div>
  )
}

function MemberUsageBar({ activeCount, limit }: MemberUsage) {
  const t       = useTranslations("dashboard.memberUsage")
  const level   = memberUsageLevel(activeCount, limit)
  const percent = memberUsagePercent(activeCount, limit)
  // Billing belongs to administrators (/dashboard/parametres); anyone else just reads the bar.
  const isAdministrator = useIsAdministrator()

  // Spelled out next to the numbers so the state never relies on color alone.
  const levelLabel =
    level === "warning"  ? t("nearLimit")
    : level === "critical" ? (activeCount >= limit ? t("limitReached") : t("almostReached"))
    : null

  const usageContent = (
    <>
      {levelLabel && <span className={cn("font-medium", LEVEL_TEXT_CLASS[level])}>{levelLabel}</span>}
      <span className="tabular-nums">{t("label", { active: activeCount, limit })}</span>
      <div
        role="progressbar"
        aria-label={t("ariaLabel")}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(activeCount, limit)}
        className="h-1.5 w-48 overflow-hidden rounded-full bg-muted-foreground/20"
      >
        <div className={cn("h-full rounded-full", BAR_FILL_CLASS[level])} style={{ width: `${percent}%` }} />
      </div>
    </>
  )

  if (!isAdministrator) {
    return <div className="space-y-1.5 text-xs text-muted-foreground">{usageContent}</div>
  }

  return (
    <Link
      href={BILLING_SETTINGS_PATH}
      className="block space-y-1.5 rounded-md text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {usageContent}
    </Link>
  )
}

"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
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
}

// Flat summary line under the page header (CLAUDE.md §8/§13): member counts as typography,
// plan usage as a thin bar — no stat cards.
export function MemberSummary({ totalCount, activeCount }: Props) {
  const t = useTranslations("dashboard")

  // Own query (see /api/dashboard/member-usage): a Stripe hiccup only hides the bar.
  const { data: usage } = useQuery<MemberUsage>({
    queryKey: ["dashboard", "member-usage"],
    queryFn:  async () => {
      const response = await fetch("/api/dashboard/member-usage")
      if (!response.ok) throw new Error("member-usage")
      return response.json()
    },
  })

  const hasCounts = totalCount != null && activeCount != null

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
      <p className="text-muted-foreground tabular-nums">
        {hasCounts ? (
          <>
            <span className="font-medium text-foreground">{t("memberSummary.total", { count: totalCount })}</span>
            {" · "}{t("memberSummary.active", { count: activeCount })}
            {" · "}{t("memberSummary.inactive", { count: Math.max(0, totalCount - activeCount) })}
          </>
        ) : "…"}
      </p>

      {usage && <MemberUsageBar activeCount={usage.activeCount} limit={usage.limit} />}
    </div>
  )
}

function MemberUsageBar({ activeCount, limit }: MemberUsage) {
  const t       = useTranslations("dashboard.memberUsage")
  const level   = memberUsageLevel(activeCount, limit)
  const percent = memberUsagePercent(activeCount, limit)

  // Spelled out next to the numbers so the state never relies on color alone.
  const levelLabel =
    level === "warning"  ? t("nearLimit")
    : level === "critical" ? (activeCount >= limit ? t("limitReached") : t("almostReached"))
    : null

  return (
    <Link
      href={BILLING_SETTINGS_PATH}
      className="flex items-center gap-3 rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {levelLabel && <span className={cn("font-medium", LEVEL_TEXT_CLASS[level])}>{levelLabel}</span>}
      <span className="tabular-nums">{t("label", { active: activeCount, limit })}</span>
      <div
        role="progressbar"
        aria-label={t("ariaLabel")}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(activeCount, limit)}
        className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", BAR_FILL_CLASS[level])} style={{ width: `${percent}%` }} />
      </div>
    </Link>
  )
}

"use client"

import Link from "next/link"
import { useTranslations, useLocale } from "next-intl"
import { format } from "date-fns"
import { HeartIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

type Don = {
  id:          string
  amount:      number
  date:        string
  donorType:   "INDIVIDUAL" | "COMPANY"
  firstName:   string
  lastName:    string
  companyName: string | null
  anonymous:   boolean
  status:      "PENDING" | "PAID"
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

interface Props {
  donsRecents: Don[]
  isLoading:   boolean
}

// Deliberately not a list of links, unlike RecentOrdersCard: there is no per-don detail
// route (/dashboard/dons/[id] is the donation *form* editor), so rows stay plain text and
// only the footer navigates — no hover affordance promising something that doesn't exist.
export function RecentDonationsCard({ donsRecents, isLoading }: Props) {
  const t = useTranslations("dashboard.recentDonations")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)

  // Same convention as the Dons page's own donor column — a COMPANY don falls back to the
  // contact's name when companyName was never filled in.
  function donorLabel(d: Don) {
    return d.donorType === "COMPANY" ? (d.companyName ?? `${d.firstName} ${d.lastName}`) : `${d.firstName} ${d.lastName}`
  }

  return (
    <div className="rounded-lg border bg-card p-5 space-y-3 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2">
        <HeartIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : donsRecents.length ? (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          {/* Only the rows scroll: a card sized shorter than its content must still
              show its footer link, and clipping the rows is what keeps the card inside
              the height the user picked. */}
          <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
          {donsRecents.map((d, i) => {
            // The list is pre-sorted PENDING-block-then-PAID-block (see /api/dashboard) —
            // a status change between two consecutive rows marks the boundary.
            const prev = donsRecents[i - 1]
            const startsNewGroup = i === 0 || prev.status !== d.status
            return (
              <div key={d.id}>
                {startsNewGroup && i > 0 && <div className="h-px bg-border my-2" />}
                {startsNewGroup && d.status === "PENDING" && (
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500 mb-1">
                    {t("pending", { count: donsRecents.filter(x => x.status === "PENDING").length })}
                  </p>
                )}
                {startsNewGroup && d.status === "PAID" && i > 0 && (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    {t("recent")}
                  </p>
                )}
                <div
                  className={cn(
                    "flex items-center justify-between -mx-1 px-1.5 py-0.5",
                    d.status === "PENDING" && "border-l-2 border-amber-500",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{donorLabel(d)}</p>
                    <p className={cn("text-xs", d.status === "PENDING" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
                      {format(new Date(d.date), "d MMM", { locale: dateFnsLocale })}
                      {d.anonymous && <span className="text-muted-foreground"> · {t("anonymous")}</span>}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0 ml-2">{fmt(d.amount)}</span>
                </div>
              </div>
            )
          })}
          </div>
          <Link href="/dashboard/dons?tab=dons" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
            {t("viewAll")}
            <ArrowRightIcon className="size-3" />
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  )
}

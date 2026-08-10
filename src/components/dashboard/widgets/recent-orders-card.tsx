"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ShoppingBagIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

type Vente = {
  id:          string
  totalAmount: number
  date:        string
  guestName:   string | null
  membre:      { firstName: string; lastName: string } | null
  status:      "PENDING" | "PAID"
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

interface Props {
  ventesRecentes: Vente[]
  isLoading: boolean
}

export function RecentOrdersCard({ ventesRecentes, isLoading }: Props) {
  const t = useTranslations("dashboard.recentOrders")
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3 flex flex-col">
      <div className="flex items-center gap-2">
        <ShoppingBagIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : ventesRecentes.length ? (
        <div className="space-y-2">
          {ventesRecentes.map((v, i) => {
            // The list is pre-sorted PENDING-block-then-PAID-block — a status change
            // between two consecutive rows marks the boundary.
            const prev = ventesRecentes[i - 1]
            const startsNewGroup = i === 0 || prev.status !== v.status
            return (
              <div key={v.id}>
                {startsNewGroup && i > 0 && <div className="h-px bg-border my-2" />}
                {startsNewGroup && v.status === "PENDING" && (
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500 mb-1">
                    {t("pending", { count: ventesRecentes.filter(x => x.status === "PENDING").length })}
                  </p>
                )}
                {startsNewGroup && v.status === "PAID" && i > 0 && (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    {t("recent")}
                  </p>
                )}
                <Link
                  href={`/dashboard/boutique?tab=commandes&commandeId=${v.id}`}
                  className={cn(
                    "flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors",
                    v.status === "PENDING" && "border-l-2 border-amber-500",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {v.membre ? `${v.membre.firstName} ${v.membre.lastName}` : (v.guestName ?? t("guest"))}
                    </p>
                    <p className={cn("text-xs", v.status === "PENDING" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
                      {format(new Date(v.date), "d MMM 'à' HH:mm", { locale: fr })}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0 ml-2">{fmt(v.totalAmount / 100)}</span>
                </Link>
              </div>
            )
          })}
          <Link href="/dashboard/boutique?tab=commandes" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
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

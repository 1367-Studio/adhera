"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PackageIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

type Loan = {
  id: string
  materialName: string
  borrowerName: string
  expectedReturnAt: string | null
  isOverdue: boolean
}

interface Props {
  materielEmpruntsListe: Loan[]
  materielEnRetardCount: number
  isLoading: boolean
}

export function LoanedMaterialCard({ materielEmpruntsListe, materielEnRetardCount, isLoading }: Props) {
  const t = useTranslations("dashboard.loanedMaterial")
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3 flex flex-col">
      <div className="flex items-center gap-2">
        <PackageIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : materielEmpruntsListe.length ? (
        <div className="space-y-2">
          {materielEmpruntsListe.map((l, i) => {
            const prev = materielEmpruntsListe[i - 1]
            const startsNewGroup = i === 0 || prev.isOverdue !== l.isOverdue
            // No cutoff on how old an overdue loan can be, so a loan overdue since last
            // year needs the year in the label — otherwise "3 janv." reads as this
            // January, not a year-old forgotten loan.
            const returnDate = l.expectedReturnAt ? new Date(l.expectedReturnAt) : null
            const dateFmt = returnDate && returnDate.getFullYear() !== new Date().getFullYear() ? "d MMM yyyy" : "d MMM"
            return (
              <div key={l.id}>
                {startsNewGroup && i > 0 && <div className="h-px bg-border my-2" />}
                {startsNewGroup && l.isOverdue && (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-red-600 dark:text-red-500 mb-1">
                    {t("overdue", { count: materielEnRetardCount })}
                  </p>
                )}
                {startsNewGroup && !l.isOverdue && i > 0 && (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    {t("inProgress")}
                  </p>
                )}
                <Link
                  href="/dashboard/materiel"
                  className={cn(
                    "flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors",
                    l.isOverdue && "border-l-2 border-red-500",
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {l.materialName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{l.borrowerName}</p>
                  </div>
                  <span className={cn("text-xs shrink-0 ml-2", l.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                    {returnDate ? format(returnDate, dateFmt, { locale: fr }) : t("noDueDate")}
                  </span>
                </Link>
              </div>
            )
          })}
          <Link href="/dashboard/materiel" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
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

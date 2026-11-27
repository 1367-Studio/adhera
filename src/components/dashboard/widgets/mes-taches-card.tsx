"use client"

import Link from "next/link"
import { useTranslations, useLocale } from "next-intl"
import { format } from "date-fns"
import { CheckSquareIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { tacheDueDateLocal } from "@/lib/tache-status"
import type { Locale } from "@/i18n/locales"

type TodayTache = { id: string; titre: string; status: "A_FAIRE" | "EN_COURS" | "TERMINEE" }
// "Prochaines échéances" peut inclure des tâches sans échéance pour compléter ses 3 lignes
// (voir /api/dashboard) — dueDate y est donc nullable, contrairement aux tâches "En retard"
// (toujours datées par construction : isTacheOverdue exclut dueDate null).
type UpcomingTache = TodayTache & { dueDate: string | null }
type OverdueTache  = TodayTache & { dueDate: string }

interface Props {
  openCount:  number
  todayCount: number
  // Capped to 3 server-side (see /api/dashboard) — todayCount is the field that carries the
  // real total, used for the "Voir les X tâches du jour" overflow link below.
  todayTasks: TodayTache[]
  // "Prochaines échéances" (FORM-128) — already capped to 3 and sorted by nearest due date
  // server-side (buildTacheWhere dueFilter "fromTomorrow"), no overflow link per the ticket:
  // "Voir mes tâches" below is the only way to reach the rest.
  upcomingTasks: UpcomingTache[]
  // "En retard" (FORM-128, print du 2026-11-27, deuxième commentaire Emmanuelle) — une tâche
  // en retard n'entrait ni dans "Aujourd'hui" ni dans "Prochaines échéances", donc restait
  // invisible malgré openCount qui la comptait. Placée avant "Aujourd'hui" (priorité la plus
  // haute) ; overdueCount porte le "Voir les X tâches en retard" comme todayCount pour today.
  overdueCount: number
  overdueTasks: OverdueTache[]
  membreId:      string
  isLoading:     boolean
}

// Statut → variant partagé avec la colonne "Statut" de taches-view.tsx — TERMINEE n'apparaît
// jamais ici (todayTasks exclut déjà les tâches terminées, voir buildTacheWhere dueFilter
// "today"), mais le type le liste quand même puisque c'est le même TacheStatus partout.
const STATUS_VARIANT = { A_FAIRE: "secondary", EN_COURS: "warning", TERMINEE: "success" } as const

const STATUS_LABEL_KEY = { A_FAIRE: "aFaire", EN_COURS: "enCours", TERMINEE: "terminee" } as const

export function MesTachesCard({ openCount, todayCount, todayTasks, upcomingTasks, overdueCount, overdueTasks, membreId, isLoading }: Props) {
  const t = useTranslations("dashboard.mesTaches")
  const tTaches = useTranslations("taches")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const currentYear = new Date().getFullYear()
  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-3 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckSquareIcon className="size-4.5 text-muted-foreground" />
          <span className="text-base font-medium">{t("title")}</span>
        </div>
        {/* openCount === 0 implies todayTasks is also empty (today ⊆ open) — the "Aujourd'hui"
            empty state below already says so, so no badge here avoids saying it twice. */}
        {!isLoading && openCount > 0 && <Badge variant="secondary">{t("openCount", { count: openCount })}</Badge>}
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          {overdueTasks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-destructive">{t("overdue")}</p>
              {overdueTasks.map(tache => {
                const dueDate = tacheDueDateLocal(tache.dueDate)
                const dateFormat = dueDate.getFullYear() !== currentYear ? "d MMM yyyy" : "d MMM"
                return (
                  <Link
                    key={tache.id}
                    href={`/dashboard/taches?tache=${tache.id}`}
                    className="flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
                  >
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{tache.titre}</span>
                    <span className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-destructive font-medium">{format(dueDate, dateFormat, { locale: dateFnsLocale })}</span>
                      <Badge variant={STATUS_VARIANT[tache.status]}>
                        {tTaches(`status.${STATUS_LABEL_KEY[tache.status]}`)}
                      </Badge>
                    </span>
                  </Link>
                )
              })}
              {overdueCount > overdueTasks.length && (
                <Link
                  href={`/dashboard/taches?membre=${membreId}&status=EN_RETARD`}
                  className="block text-xs text-muted-foreground hover:underline pt-1"
                >
                  {t("seeMoreOverdue", { count: overdueCount })}
                </Link>
              )}
            </div>
          )}
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("today")}</p>
          {todayTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyToday")}</p>
          ) : (
            <div className="flex-1 min-h-0 space-y-1 overflow-y-auto">
              {todayTasks.map(tache => (
                <Link
                  key={tache.id}
                  href={`/dashboard/taches?tache=${tache.id}`}
                  className="flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
                >
                  <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{tache.titre}</span>
                  <Badge variant={STATUS_VARIANT[tache.status]} className="shrink-0 ml-2">
                    {tTaches(`status.${STATUS_LABEL_KEY[tache.status]}`)}
                  </Badge>
                </Link>
              ))}
              {todayCount > todayTasks.length && (
                <Link
                  href={`/dashboard/taches?membre=${membreId}&dueFilter=today`}
                  className="block text-xs text-muted-foreground hover:underline pt-1"
                >
                  {t("seeMoreToday", { count: todayCount })}
                </Link>
              )}
            </div>
          )}
          {upcomingTasks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("upcoming")}</p>
              {upcomingTasks.map(tache => {
                const dueDate = tache.dueDate ? tacheDueDateLocal(tache.dueDate) : null
                const dateFormat = dueDate && dueDate.getFullYear() !== currentYear ? "d MMM yyyy" : "d MMM"
                return (
                  <Link
                    key={tache.id}
                    href={`/dashboard/taches?tache=${tache.id}`}
                    className="flex items-center justify-between group -mx-1 px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
                  >
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{tache.titre}</span>
                    <span className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-muted-foreground">
                        {dueDate ? format(dueDate, dateFormat, { locale: dateFnsLocale }) : tTaches("detailSheet.sansEcheance")}
                      </span>
                      <Badge variant={STATUS_VARIANT[tache.status]}>
                        {tTaches(`status.${STATUS_LABEL_KEY[tache.status]}`)}
                      </Badge>
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
          <Link href="/dashboard/taches" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
            {t("viewAll")}
            <ArrowRightIcon className="size-3" />
          </Link>
        </div>
      )}
    </div>
  )
}

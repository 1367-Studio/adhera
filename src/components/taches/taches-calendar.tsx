"use client"

import { useState } from "react"
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, isToday,
  addMonths, subMonths,
} from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
import { CaretLeftIcon, CaretRightIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useTachesByMonth, type Tache } from "@/hooks/use-taches"
import { isTacheOverdue, tacheDueDateLocal } from "@/lib/tache-status"
import { cn } from "@/lib/utils"

const MAX_VISIBLE = 3

const TACHE_COLORS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
]

function tacheColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return TACHE_COLORS[hash % TACHE_COLORS.length]
}

function initials(m: { firstName: string; lastName: string }) {
  return `${m.firstName[0] ?? ""}${m.lastName[0] ?? ""}`.toUpperCase()
}

interface TachesCalendarProps {
  onTacheClick:  (tache: Tache) => void
  /** Omitted for a "read" user: the calendar then offers no way to create a task. */
  onCreateClick?: (date?: Date) => void
}

export function TachesCalendar({ onTacheClick, onCreateClick }: TachesCalendarProps) {
  const t = useTranslations()
  const dayHeaders = [
    t("evenements.calendar.days.mon"), t("evenements.calendar.days.tue"), t("evenements.calendar.days.wed"),
    t("evenements.calendar.days.thu"), t("evenements.calendar.days.fri"), t("evenements.calendar.days.sat"),
    t("evenements.calendar.days.sun"),
  ]
  const [current,  setCurrent]  = useState(() => new Date())
  const [selected, setSelected] = useState<Date | null>(null)
  const [direction, setDirection] = useState<"left" | "right">("right")

  const year  = current.getFullYear()
  const month = current.getMonth()

  const { data: taches = [], isLoading } = useTachesByMonth(year, month)

  const monthStart = startOfMonth(current)
  const monthEnd   = endOfMonth(current)
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd    = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function goNext() { setDirection("right"); setCurrent(d => addMonths(d, 1)) }
  function goPrev() { setDirection("left");  setCurrent(d => subMonths(d, 1)) }
  function goToday() {
    const today = new Date()
    setDirection(today > current ? "right" : "left")
    setCurrent(today)
  }

  function tachesForDay(day: Date) {
    // dueDate n'est jamais null ici en pratique (useTachesByMonth filtre par plage de
    // dates, et NULL ne matche jamais une comparaison lt/gte en SQL) — le garde `?.` reste
    // défensif plutôt que de supposer cette invariante. tacheDueDateLocal recompose le jour
    // calendaire UTC en champs locaux pour que isSameDay() (qui lit l'heure locale) ne place
    // pas la tâche sur le mauvais jour pour un visiteur en arrière de UTC.
    return taches.filter(tache => tache.dueDate && isSameDay(tacheDueDateLocal(tache.dueDate), day))
  }

  const selectedTaches = selected ? tachesForDay(selected) : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" onClick={goPrev}>
            <CaretLeftIcon className="size-4" />
          </Button>
          <h2 key={`${year}-${month}`} className="text-base font-semibold w-40 text-center capitalize">
            {format(current, "MMMM yyyy", { locale: fr })}
          </h2>
          <Button variant="outline" size="icon" className="size-8" onClick={goNext}>
            <CaretRightIcon className="size-4" />
          </Button>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={goToday} />}>
              {t("evenements.calendar.today")}
            </TooltipTrigger>
            <TooltipContent>{t("evenements.calendar.todayTooltip")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {dayHeaders.map(d => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>

        <div
          key={`grid-${year}-${month}`}
          className={cn("grid grid-cols-7", direction === "right" ? "slide-in-from-right-4" : "slide-in-from-left-4")}
        >
          {days.map((day, i) => {
            const dayTaches  = tachesForDay(day)
            const isCurrentM = isSameMonth(day, current)
            const isTodayD   = isToday(day)
            const isSelected = selected ? isSameDay(day, selected) : false
            const visible    = dayTaches.slice(0, MAX_VISIBLE)
            const overflow   = dayTaches.length - MAX_VISIBLE

            return (
              <div
                key={i}
                onClick={() => setSelected(d => d && isSameDay(d, day) ? null : day)}
                className={cn(
                  "min-h-[90px] p-1.5 border-b border-r cursor-pointer transition-colors",
                  !isCurrentM && "bg-muted/20",
                  isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                  isCurrentM && !isSelected && "hover:bg-muted/30",
                  (i + 1) % 7 === 0 && "border-r-0",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    isTodayD ? "bg-primary text-primary-foreground" : isCurrentM ? "text-foreground" : "text-muted-foreground/40",
                  )}>
                    {format(day, "d")}
                  </span>
                  {isCurrentM && onCreateClick && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCreateClick(day) }}
                      className="opacity-0 hover:!opacity-100 flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity"
                    >
                      <PlusIcon className="size-3" />
                    </button>
                  )}
                </div>

                <div className="space-y-0.5">
                  {isLoading ? (
                    <div className="h-4 rounded bg-muted animate-pulse" />
                  ) : (
                    <>
                      {visible.map(tache => {
                        const overdue = isTacheOverdue(tache)
                        const firstAssignee = tache.assignees[0]?.membre
                        return (
                          <button
                            key={tache.id}
                            onClick={(e) => { e.stopPropagation(); setSelected(day) }}
                            className={cn(
                              "w-full flex items-center gap-1 text-left truncate rounded px-1.5 py-0.5 text-xs font-medium leading-snug transition-colors",
                              overdue ? "bg-destructive/10 text-destructive" : tacheColor(tache.id),
                            )}
                            title={tache.titre}
                          >
                            {overdue && <WarningCircleIcon className="size-3 shrink-0" />}
                            {firstAssignee && (
                              <span className="shrink-0 inline-flex size-4 items-center justify-center rounded-full bg-background/60 text-[9px] font-semibold">
                                {initials(firstAssignee)}
                              </span>
                            )}
                            <span className="truncate">{tache.titre}</span>
                          </button>
                        )
                      })}
                      {overflow > 0 && (
                        <p className="px-1 text-xs text-muted-foreground font-medium">
                          {t("taches.calendar.othersCount", { count: overflow })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <div key={selected.toISOString()} className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold capitalize">
              {format(selected, "EEEE d MMMM yyyy", { locale: fr })}
            </h3>
            {onCreateClick && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onCreateClick(selected)}>
                <PlusIcon className="size-3 mr-1" /> {t("taches.calendar.createHere")}
              </Button>
            )}
          </div>

          {selectedTaches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("taches.calendar.noTacheThisDay")}</p>
          ) : (
            <div className="space-y-2">
              {selectedTaches.map(tache => {
                const overdue = isTacheOverdue(tache)
                const statusConfig = {
                  A_FAIRE:  { label: t("taches.status.aFaire"),  variant: "secondary" as const },
                  EN_COURS: { label: t("taches.status.enCours"), variant: "warning" as const },
                  TERMINEE: { label: t("taches.status.terminee"), variant: "success" as const },
                }[tache.status]
                return (
                  <button
                    key={tache.id}
                    onClick={() => onTacheClick(tache)}
                    className="w-full rounded-lg border p-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{tache.titre}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                          {tache.categorie && <span>{tache.categorie.nom}</span>}
                          <span>
                            {tache.assignees.length === 0
                              ? t("taches.detailSheet.nonAttribuee")
                              : tache.assignees.map(a => `${a.membre.firstName} ${a.membre.lastName}`).join(", ")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                        {overdue && <Badge variant="destructive"><WarningCircleIcon className="size-3" /></Badge>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

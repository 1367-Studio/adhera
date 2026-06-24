"use client"

import { useState } from "react"
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, isToday,
  addMonths, subMonths,
} from "date-fns"
import { fr } from "date-fns/locale"
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon, UsersIcon, PlusIcon, PencilIcon } from "lucide-react"
import { RowActions } from "@/components/ui/row-actions"
import { PriceBadge } from "@/components/ui/price-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useEvenementsByMonth, type CalendarEvenement } from "@/hooks/use-evenements"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const DAY_HEADERS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
const MAX_VISIBLE  = 3

const EVENT_COLORS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
]

function eventColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return EVENT_COLORS[hash % EVENT_COLORS.length]
}

interface EvenementsCalendarProps {
  onEditClick:      (ev: CalendarEvenement) => void
  onPresencesClick: (ev: CalendarEvenement) => void
  onCreateClick:    (date?: Date) => void
}

export function EvenementsCalendar({ onEditClick, onPresencesClick, onCreateClick }: EvenementsCalendarProps) {
  const [current,   setCurrent]   = useState(() => new Date())
  const [selected,  setSelected]  = useState<Date | null>(null)
  const [direction, setDirection] = useState<"left" | "right">("right")

  const year  = current.getFullYear()
  const month = current.getMonth()

  const { data: events = [], isLoading } = useEvenementsByMonth(year, month)

  const monthStart = startOfMonth(current)
  const monthEnd   = endOfMonth(current)
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd    = endOfWeek(monthEnd,     { weekStartsOn: 1 })
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function goNext() {
    setDirection("right")
    setCurrent(d => addMonths(d, 1))
  }
  function goPrev() {
    setDirection("left")
    setCurrent(d => subMonths(d, 1))
  }
  function goToday() {
    const today = new Date()
    setDirection(today > current ? "right" : "left")
    setCurrent(today)
  }

  function eventsForDay(day: Date) {
    return events.filter(e => isSameDay(new Date(e.date), day))
  }

  const selectedEvents = selected ? eventsForDay(selected) : []

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" onClick={goPrev}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          {/* key forces re-mount → fade-in on every month change */}
          <h2
            key={`${year}-${month}`}
            className="text-base font-semibold w-40 text-center capitalize animate-in fade-in duration-300"
            style={{ animationFillMode: "both" }}
          >
            {format(current, "MMMM yyyy", { locale: fr })}
          </h2>
          <Button variant="outline" size="icon" className="size-8" onClick={goNext}>
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={goToday} />}>
              Aujourd&apos;hui
            </TooltipTrigger>
            <TooltipContent>Revenir au mois actuel</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="rounded-xl border overflow-hidden">
        {/* Day headers — static, no animation */}
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {DAY_HEADERS.map(d => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Grid — key triggers remount + slide animation on month change */}
        <div
          key={`grid-${year}-${month}`}
          className={cn(
            "grid grid-cols-7 animate-in fade-in-0 duration-300",
            direction === "right" ? "slide-in-from-right-4" : "slide-in-from-left-4",
          )}
          style={{ animationFillMode: "both" }}
        >
          {days.map((day, i) => {
            const dayEvents  = eventsForDay(day)
            const isCurrentM = isSameMonth(day, current)
            const isTodayD   = isToday(day)
            const isSelected = selected ? isSameDay(day, selected) : false
            const visible    = dayEvents.slice(0, MAX_VISIBLE)
            const overflow   = dayEvents.length - MAX_VISIBLE

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
                    isTodayD
                      ? "bg-primary text-primary-foreground"
                      : isCurrentM ? "text-foreground" : "text-muted-foreground/40",
                  )}>
                    {format(day, "d")}
                  </span>
                  {isCurrentM && (
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
                      {visible.map((ev, idx) => (
                        <button
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); setSelected(day) }}
                          className={cn(
                            "w-full text-left truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-snug",
                            "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 hover:opacity-80 transition-opacity",
                            eventColor(ev.id),
                          )}
                          style={{ animationDelay: `${idx * 40}ms`, animationFillMode: "both" }}
                          title={ev.title}
                        >
                          {format(new Date(ev.date), "HH:mm")} {ev.title}
                        </button>
                      ))}
                      {overflow > 0 && (
                        <p className="px-1 text-[11px] text-muted-foreground font-medium animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
                          +{overflow} autre{overflow > 1 ? "s" : ""}
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

      {/* Selected day panel — slides up on entry */}
      {selected && (
        <div
          key={selected.toISOString()}
          className="rounded-xl border bg-card p-4 space-y-3 animate-in fade-in-0 slide-in-from-bottom-3 duration-250"
          style={{ animationFillMode: "both" }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold capitalize">
              {format(selected, "EEEE d MMMM yyyy", { locale: fr })}
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onCreateClick(selected)}>
              <PlusIcon className="size-3 mr-1" /> Créer ici
            </Button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun événement ce jour.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev, idx) => (
                <div
                  key={ev.id}
                  className="rounded-lg border p-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
                  style={{ animationDelay: `${idx * 50}ms`, animationFillMode: "both" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{ev.title}</p>
                        <PriceBadge price={ev.price} className="shrink-0" />
                      </div>
                      <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-muted-foreground">
                        <span>
                          {format(new Date(ev.date), "HH:mm", { locale: fr })}
                          {ev.endDate ? ` → ${format(new Date(ev.endDate), "HH:mm", { locale: fr })}` : ""}
                        </span>
                        {ev.location && (
                          <span className="flex items-center gap-1">
                            <MapPinIcon className="size-3" />{ev.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ev._count.participations > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <UsersIcon className="size-3.5" />{ev._count.participations}
                        </span>
                      )}
                      <RowActions actions={[
                        { label: "Présences", icon: <UsersIcon className="size-3.5" />,  onClick: () => onPresencesClick(ev) },
                        { label: "Modifier",  icon: <PencilIcon className="size-3.5" />, onClick: () => onEditClick(ev), separator: true },
                      ]} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

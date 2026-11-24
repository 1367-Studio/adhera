"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CalendarBlankIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"

type ProchainEvenement = {
  id: string
  title: string
  date: string
  location: string | null
  enCours: boolean
}

interface Props {
  evenementsMois:    number
  prochainEvenement: ProchainEvenement | null
  isLoading: boolean
}

// Merges the former stat-evenements tile ("N événements ce mois") and next-event widget into
// one card — FORM-120's "Agenda" grouping.
export function AgendaCard({ evenementsMois, prochainEvenement, isLoading }: Props) {
  const t = useTranslations("dashboard.agenda")

  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarBlankIcon className="size-4.5 text-muted-foreground" />
        <span className="text-base font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("eventsThisMonth", { count: evenementsMois })}
          </p>
          {prochainEvenement ? (
            // truncate (not wrap): the card's h:2 grid cell is a fixed box with
            // overflow-hidden (see sortable-widget.tsx) — a long title/location wrapping to
            // extra lines would get silently clipped mid-text instead of ending in an
            // ellipsis, so every line here stays single-line on purpose.
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="min-w-0 truncate text-sm font-medium">{prochainEvenement.title}</p>
                {prochainEvenement.enCours && <Badge variant="default" className="shrink-0">{t("ongoing")}</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {format(new Date(prochainEvenement.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
              </p>
              {prochainEvenement.location && (
                <p className="truncate text-xs text-muted-foreground">{prochainEvenement.location}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}
          <Link href="/dashboard/evenements?view=calendar" className="text-xs text-muted-foreground hover:underline flex items-center gap-1 pt-1">
            {t("viewCalendar")}
            <ArrowRightIcon className="size-3" />
          </Link>
        </div>
      )}
    </div>
  )
}

"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr"

interface Props {
  prochainEvenement: { id: string; title: string; date: string; location: string | null } | null
  isLoading: boolean
}

export function NextEventCard({ prochainEvenement, isLoading }: Props) {
  const t = useTranslations("dashboard.nextEvent")
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarBlankIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("title")}</span>
      </div>
      {isLoading ? (
        <div className="h-12 rounded-lg bg-muted animate-pulse" />
      ) : prochainEvenement ? (
        <Link href="/dashboard/evenements" className="block group">
          <p className="font-semibold group-hover:text-primary transition-colors">
            {prochainEvenement.title}
          </p>
          <p className="text-sm text-muted-foreground">
            {format(new Date(prochainEvenement.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
          </p>
          {prochainEvenement.location && (
            <p className="text-xs text-muted-foreground">{prochainEvenement.location}</p>
          )}
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  )
}

"use client"

import { useLocale } from "next-intl"
import { format, isSameDay } from "date-fns"
import { CalendarBlankIcon, MapPinIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"
import type { Evenement } from "./types"

const DATE_TIME_FORMAT = "d MMM yyyy, HH:mm"

/**
 * Date + location line of an event. `compact` is the list card (start date only, xs text);
 * `detailed` is the event page (adds the end date, sm text).
 */
export function EventMeta({
  evenement,
  variant = "compact",
  className,
}: {
  evenement: Pick<Evenement, "date" | "endDate" | "location" | "lat" | "lng">
  variant?:  "compact" | "detailed"
  className?: string
}) {
  const locale        = useLocale()
  const dateFnsLocale = getDateFnsLocale(locale as Locale)
  const isDetailed    = variant === "detailed"
  const iconClassName = isDetailed ? "size-4" : "size-3"
  const startDate     = new Date(evenement.date)
  const endDate       = isDetailed && evenement.endDate ? new Date(evenement.endDate) : null

  return (
    <div className={cn(
      "flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground",
      isDetailed ? "text-sm" : "text-xs",
      className,
    )}>
      <span className="flex items-center gap-1">
        <CalendarBlankIcon className={iconClassName} />
        {format(startDate, DATE_TIME_FORMAT, { locale: dateFnsLocale })}
        {endDate && (
          <> — {format(endDate, isSameDay(startDate, endDate) ? "HH:mm" : DATE_TIME_FORMAT, { locale: dateFnsLocale })}</>
        )}
      </span>
      {evenement.location && (
        <span className="flex items-center gap-1">
          <MapPinIcon className={iconClassName} />
          {evenement.lat != null && evenement.lng != null ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${evenement.lat},${evenement.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline inline-flex items-center gap-0.5"
            >
              {evenement.location} <ArrowSquareOutIcon className={isDetailed ? "size-3.5" : "size-2.5"} />
            </a>
          ) : evenement.location}
        </span>
      )}
    </div>
  )
}

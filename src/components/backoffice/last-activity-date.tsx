import { formatDistanceToNow } from "date-fns"
import { fr } from "date-fns/locale"
import { APP_TIME_ZONE } from "@/lib/date-format"

// Relative "il y a 3 jours" label for User.lastLoginAt / lastSeenAt in the back-office, with
// the exact date/time on hover. Null = never recorded since those columns were added.
export function LastActivityDate({ date }: { date: Date | null }) {
  if (!date) return <span className="text-muted-foreground">Jamais</span>

  const exactDateTime = date.toLocaleString("fr-FR", {
    timeZone: APP_TIME_ZONE, dateStyle: "short", timeStyle: "short",
  })
  return (
    <time dateTime={date.toISOString()} title={exactDateTime}>
      {formatDistanceToNow(date, { addSuffix: true, locale: fr })}
    </time>
  )
}

import { APP_TIME_ZONE } from "@/lib/date-format"

// When an event counts as "over". Checking the start instant (`date < new Date()`) closed an
// event starting at 07:08 to registrations from 07:09 — and blocked the manager from adding a
// late arrival at the door. The rule is now: an event stays live until the end of the Paris
// calendar day of its last day (`endDate ?? date`). Pure Intl + Date so it runs server- and
// client-side alike (presences page, portal UI).

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

type ParisCalendarDay = { year: number; month: number; day: number }

// The Paris wall-clock reading of `instant`, re-expressed as if it were a UTC timestamp —
// subtracting the real instant from it gives Paris' UTC offset at that moment.
function parisWallClockAsUtc(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(instant)
  const partValue = (partType: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === partType)?.value)
  return Date.UTC(partValue("year"), partValue("month") - 1, partValue("day"), partValue("hour"), partValue("minute"), partValue("second"))
}

function parisCalendarDayOf(instant: Date): ParisCalendarDay {
  const wallClock = new Date(parisWallClockAsUtc(instant))
  return { year: wallClock.getUTCFullYear(), month: wallClock.getUTCMonth(), day: wallClock.getUTCDate() }
}

// The real instant at which Paris' clock reads 00:00 on the given calendar day. The offset is
// measured at that local midnight itself (not at `instant`), so DST switch days stay exact.
function parisMidnightOf(calendarDay: ParisCalendarDay): Date {
  const midnightAsUtc = Date.UTC(calendarDay.year, calendarDay.month, calendarDay.day)
  const firstOffsetGuess = parisWallClockAsUtc(new Date(midnightAsUtc)) - midnightAsUtc
  const candidateInstant = midnightAsUtc - firstOffsetGuess
  const offsetAtCandidate = parisWallClockAsUtc(new Date(candidateInstant)) - candidateInstant
  return new Date(midnightAsUtc - offsetAtCandidate)
}

/** First millisecond of the Europe/Paris calendar day containing `instant`. */
export function startOfParisDay(instant: Date): Date {
  return parisMidnightOf(parisCalendarDayOf(instant))
}

/** Last millisecond of the Europe/Paris calendar day containing `instant` (DST-safe). */
export function endOfParisDay(instant: Date): Date {
  const calendarDay = parisCalendarDayOf(instant)
  // Date.UTC normalizes day overflow (31 → 1st of next month), so +1 day is always valid.
  const nextDayAsUtc = new Date(Date.UTC(calendarDay.year, calendarDay.month, calendarDay.day) + MILLISECONDS_PER_DAY)
  const nextMidnight = parisMidnightOf({
    year: nextDayAsUtc.getUTCFullYear(), month: nextDayAsUtc.getUTCMonth(), day: nextDayAsUtc.getUTCDate(),
  })
  return new Date(nextMidnight.getTime() - 1)
}

type EvenementDates = { date: Date | string; endDate?: Date | string | null }

/** The instant after which the event is over: end of the Paris day of `endDate ?? date`. */
export function evenementEndsAt(evenement: EvenementDates): Date {
  return endOfParisDay(new Date(evenement.endDate ?? evenement.date))
}

/** True once the Paris calendar day of the event's last day has fully elapsed. */
export function isEvenementOver(evenement: EvenementDates, now: Date = new Date()): boolean {
  return now.getTime() > evenementEndsAt(evenement).getTime()
}

/**
 * Prisma `where` fragment for events that are not over yet (today's events included).
 * It uses `OR` — callers whose where already has an `OR` must combine both under `AND`.
 */
export function evenementNotOverWhere(now: Date = new Date()) {
  const todayStart = startOfParisDay(now)
  return {
    OR: [
      { endDate: { gte: todayStart } },
      { endDate: null, date: { gte: todayStart } },
    ],
  }
}

/** Prisma `where` fragment for events that are over — the exact complement of evenementNotOverWhere. */
export function evenementOverWhere(now: Date = new Date()) {
  const todayStart = startOfParisDay(now)
  return {
    OR: [
      { endDate: { lt: todayStart } },
      { endDate: null, date: { lt: todayStart } },
    ],
  }
}

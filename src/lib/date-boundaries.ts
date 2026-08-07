/**
 * Deadlines are date-only in the UI (`<input type="date">`) but stored as an end-of-day UTC
 * timestamp. Comparing against the exact current instant would make "today" flip to expired
 * hours before the local day is actually over for any timezone behind UTC (e.g. Quebec) —
 * this gives the full UTC calendar day of grace instead, consistently everywhere a deadline
 * is checked (create/edit validation, activation, admin auto-close, member portal access).
 */
export function startOfTodayUTC(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

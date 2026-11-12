// Vercel serverless functions run in UTC, so a Date formatted server-side without an
// explicit timeZone renders in UTC rather than in the associations' own time: an event at
// 09:00 Paris goes out in its confirmation email as 07:00, two hours before it starts, while
// the public event page shows the correct 09:00 — that page is a client component, so it
// formats in the visitor's own browser timezone. Same instant, two different readings, and
// the emailed one is the wrong one.
//
// Every date or time rendered on the server for a human to read must pass this. The same
// reasoning already anchors currentCotisationYear (see lib/membre-adherent.ts), which this
// generalizes.
//
// Deliberately a single constant and not a per-association setting: every association on
// the platform is French today. The day that stops being true, this is the one place to
// widen into a lookup.
export const APP_TIME_ZONE = "Europe/Paris"

/**
 * A calendar date (no time-of-day meaning — a Grupo appel, an Exercice boundary, a Cotisation
 * period…) is stored as UTC midnight (see src/lib/finance/exercice.ts). Passing it straight to
 * date-fns' format() reads it back through the LOCAL getters, which rolls it back a day for
 * every timezone behind UTC (most of Brazil, the Americas…). This re-anchors it to local
 * midnight on the same calendar day first, so format() then reads the correct date regardless
 * of the browser/server's own timezone.
 */
export function dateOnlyToLocal(value: Date | string): Date {
  const d = typeof value === "string" ? new Date(value) : value
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

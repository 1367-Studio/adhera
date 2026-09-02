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

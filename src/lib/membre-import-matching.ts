// Shared between the import route's synchronous plan-limit precheck
// (src/app/api/membres/import/route.ts) and the actual matching loop, which now runs in the
// Inngest function (src/inngest/membres-import.ts) — both need the exact same identity rules
// or the precheck's estimate can drift from what the real loop does.

// AssoConnect substitutes this for a real address once it's had a hard bounce (confirmed by
// inspecting a real contact's profile: "adresse invalide suite à un ou plusieurs rejets") —
// several genuinely unrelated people can end up sharing it, so it must never be used to match
// an existing Membre the way a real shared-household email legitimately can.
export function isPlaceholderEmail(email: string): boolean {
  return /^inconnue?@/i.test(email.trim())
}

// Accent-insensitive name comparison — Postgres's `mode: "insensitive"` only folds case, not
// diacritics, and AssoConnect exports are full of accented French/Portuguese names (José,
// Amélia...). Without this, a re-export with a slightly different accent/encoding on the same
// person's name would silently fail to match and create a duplicate instead.
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

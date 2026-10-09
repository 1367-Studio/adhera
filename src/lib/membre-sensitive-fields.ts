import { hasAccess, type ResolvedPermissions } from "@/lib/permissions"

// Security audit M2+L8 — the fields a staff member needs the `sensible` area to see: health
// data (groupeSanguin/allergies, GDPR Art. 9 special category) and a minor's guardian contact
// info. Single list, reused by every read path (GET list/detail, export) and every write path
// (POST create, PATCH update) so the two can never drift apart.
export const SENSITIVE_MEMBRE_FIELDS = [
  "groupeSanguin", "allergies",
  "guardianName", "guardianPhone", "secondGuardianName", "secondGuardianPhone",
] as const

export function hasSensitiveMembreAccess(permissions: ResolvedPermissions): boolean {
  return hasAccess(permissions, "sensible", "read")
}

// For a response object about to go out as JSON — deletes the sensitive keys outright rather
// than nulling them, so an unauthorized caller can't tell a real null (field genuinely empty)
// apart from a redacted one.
export function redactSensitiveMembreFields<T extends Record<string, unknown>>(record: T, permissions: ResolvedPermissions): T {
  if (hasSensitiveMembreAccess(permissions)) return record
  const redacted = { ...record }
  for (const field of SENSITIVE_MEMBRE_FIELDS) delete redacted[field]
  return redacted
}

// For a parsed request body about to be written (POST create / PATCH update) — forces the
// sensitive keys to `undefined` when the actor lacks access, regardless of what the client
// sent. Every write site here already treats `undefined` as "field not submitted, leave
// whatever's in the DB alone" (see membreUpdateSchema's own `!== undefined` checks), so this
// makes an unauthorized write silently a no-op on these fields instead of either persisting a
// value the actor was never allowed to set, or — the real bug this closes — wiping an existing
// value just because the client's own hidden inputs round-tripped an empty string it was never
// shown the real content of.
export function stripSensitiveMembreFields<T extends Record<string, unknown>>(data: T, permissions: ResolvedPermissions): T {
  if (hasSensitiveMembreAccess(permissions)) return data
  const stripped = { ...data }
  for (const field of SENSITIVE_MEMBRE_FIELDS) (stripped as Record<string, unknown>)[field] = undefined
  return stripped
}

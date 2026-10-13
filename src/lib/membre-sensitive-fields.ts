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

// "Lecture" lets you see these fields; only "Édition" lets you change them. Previously the
// write-gate reused hasSensitiveMembreAccess (a "read" check), so anyone with "Lecture" could
// still overwrite groupeSanguin/allergies/guardian* via PATCH — fixed alongside the custom-field
// extension below, which needs this same read/edit distinction to behave correctly.
export function hasSensitiveMembreEditAccess(permissions: ResolvedPermissions): boolean {
  return hasAccess(permissions, "sensible", "edit")
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
// sensitive keys to `undefined` when the actor lacks edit access, regardless of what the client
// sent. Every write site here already treats `undefined` as "field not submitted, leave
// whatever's in the DB alone" (see membreUpdateSchema's own `!== undefined` checks), so this
// makes an unauthorized write silently a no-op on these fields instead of either persisting a
// value the actor was never allowed to set, or — the real bug this closes — wiping an existing
// value just because the client's own hidden inputs round-tripped an empty string it was never
// shown the real content of.
export function stripSensitiveMembreFields<T extends Record<string, unknown>>(data: T, permissions: ResolvedPermissions): T {
  if (hasSensitiveMembreEditAccess(permissions)) return data
  const stripped = { ...data }
  for (const field of SENSITIVE_MEMBRE_FIELDS) (stripped as Record<string, unknown>)[field] = undefined
  return stripped
}

// --- Extension: MembershipFormField.sensible (custom-field answers, dynamic Membre.answers) ---
//
// The fixed fields above live as named Membre columns, so they can be redacted/stripped by key
// name. A sensitive custom field instead lives as one entry of the dynamic Membre.answers JSON,
// keyed by MembershipFormField.id — there's no fixed name to list up front, so filtering has to
// happen against whichever MembershipFormField rows the caller already loaded and tagged
// `sensible` on, not against a hardcoded list like SENSITIVE_MEMBRE_FIELDS.

type CustomFieldAnswer = { label: string; value: string; sensible: boolean }

// GET detail — drops (not blanks) any answer whose field is sensible and the actor lacks "read".
export function filterSensitiveCustomFieldAnswers<T extends CustomFieldAnswer>(answers: T[], permissions: ResolvedPermissions): T[] {
  if (hasSensitiveMembreAccess(permissions)) return answers
  return answers.filter(a => !a.sensible)
}

type EditableCustomField<F extends { sensible: boolean }> = { field: F; value: string }

// GET detail (for the edit form) — drops entries the actor can't even see ("none"); on the ones
// that remain, flags `readOnly` when the actor can see but not edit (sensitive + only "Lecture"),
// so the form can render the input disabled instead of letting it be submitted.
export function filterEditableSensitiveCustomFields<F extends { sensible: boolean }>(
  fields: EditableCustomField<F>[],
  permissions: ResolvedPermissions,
): (EditableCustomField<F> & { readOnly: boolean })[] {
  const canSee = hasSensitiveMembreAccess(permissions)
  const canEdit = hasSensitiveMembreEditAccess(permissions)
  return fields
    .filter(f => !f.field.sensible || canSee)
    .map(f => ({ ...f, readOnly: f.field.sensible && !canEdit }))
}

// PATCH — removes (not blanks) any submitted answer key whose field is sensible when the actor
// lacks edit access, before the result is merged into Membre.answers. Same defensive principle
// as stripSensitiveMembreFields: a hidden/re-enabled input in the client can't write a value for
// a field the actor was never allowed to edit.
export function stripSensitiveCustomFieldAnswers(
  answers: Record<string, string> | undefined,
  sensitiveFieldIds: ReadonlySet<string>,
  permissions: ResolvedPermissions,
): Record<string, string> | undefined {
  if (!answers || hasSensitiveMembreEditAccess(permissions) || sensitiveFieldIds.size === 0) return answers
  const stripped: Record<string, string> = {}
  for (const [key, value] of Object.entries(answers)) {
    if (sensitiveFieldIds.has(key)) continue
    stripped[key] = value
  }
  return stripped
}

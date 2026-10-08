// Per-area access of the association team (FORM-34), replacing the fixed role allowlists.
//
// Each staff user has, for every area of the dashboard, one level: "none" (hidden), "read"
// (can see, cannot change) or "edit". On top of that, "administrator" unlocks what belongs to
// no area: settings, billing, Stripe, team & access, support.
//
// Storage: User.permissions (JSON, StoredPermissions). Null for every user created before this
// existed — their access is then the profile of their role (ROLE_PROFILES), which reproduces
// exactly what that role could do before. So nobody gains or loses access at migration.
// Server-safe (no React): used by the API wrapper, the session and the dashboard alike.
//
// Exception to "nobody gains or loses access": the `sensible` area added later (security audit
// M2+L8) is deliberately fail-closed for anyone with a *custom* stored `areas` object — a
// stored blob from before this area existed has no `sensible` key, and resolvePermissions
// below treats any area missing from `areas` as "none", not "whatever ROLE_PROFILES would
// say". That's the actual fix (nobody saw guardian/health fields as a side effect of some
// unrelated grant before this), but it does mean an admin has to go re-grant "Lecture" on
// Données sensibles for any custom profile that genuinely needs it. Users with no stored
// permissions at all still get ROLE_PROFILES' `sensible` value unchanged, same as every area.

export const ACCESS_AREAS = [
  "dashboard", "membres", "sensible", "adhesions", "dons", "evenements", "boutique",
  "communication", "actualites", "comptabilite", "reunions", "materiel", "site", "documents",
] as const

export type AccessArea  = (typeof ACCESS_AREAS)[number]
export type AccessLevel = "none" | "read" | "edit"

export const ACCESS_LEVELS: readonly AccessLevel[] = ["none", "read", "edit"]

// French labels (the dashboard is French-first; translations live in messages/*.json for UI).
export const ACCESS_AREA_LABELS: Record<AccessArea, string> = {
  dashboard:     "Tableau de bord et activité",
  membres:       "Membres",
  // Security audit M2+L8 — visibility only (see hasAccess's own doc comment below): controls
  // whether groupeSanguin/allergies/guardian* appear in membre responses, the export, and the
  // guardian section of the membre detail/edit screens. "Édition" has the same effect as
  // "Lecture" for this one area — editing a Membre is a single whole-record PATCH, there's no
  // separate save path for just these fields to gate independently.
  sensible:      "Données sensibles des membres (santé, responsables de mineurs)",
  adhesions:     "Adhésions et cotisations",
  dons:          "Dons",
  evenements:    "Événements et billetterie",
  boutique:      "Boutique",
  communication: "Communication (e-mails, SMS, sondages)",
  actualites:    "Actualités",
  comptabilite:  "Comptabilité (finances, devis, factures, fournisseurs)",
  reunions:      "Réunions",
  materiel:      "Matériel",
  site:          "Site web",
  documents:     "Documents de l'association",
}

export type AreaLevels = Record<AccessArea, AccessLevel>

// What is stored in User.permissions. Areas missing from `areas` count as "none".
export type StoredPermissions = {
  administrator?: boolean
  areas?:         Partial<Record<AccessArea, AccessLevel>>
}

export type ResolvedPermissions = {
  administrator: boolean
  areas:         AreaLevels
}

// Roles that open the dashboard. MEMBRE uses the portal; SUPER_ADMIN the back office.
export const STAFF_ROLES = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE", "EQUIPE"] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role)
}

function allAreasAt(level: AccessLevel): AreaLevels {
  return Object.fromEntries(ACCESS_AREAS.map(area => [area, level])) as AreaLevels
}

const NO_ACCESS: ResolvedPermissions = { administrator: false, areas: allAreasAt("none") }

const ADMINISTRATOR_PROFILE: ResolvedPermissions = { administrator: true, areas: allAreasAt("edit") }

// What each role could do before per-area access existed (sidebar + API allowlists), so a user
// without stored permissions keeps exactly the same access. Notes on the few places where the
// old rules disagreed with themselves (sidebar vs API):
// - Trésorier: news yes, but e-mails/SMS/polls no (the polls API excluded the treasurer even
//   though the sidebar showed the tab) — hence Communication and Actualités being two areas.
// - Secrétaire: saw the cotisations list but not the membership/donation forms nor the
//   finances → Adhésions "read", Dons and Comptabilité "none".
// - Site web: administrators only, as before.
export const ROLE_PROFILES: Record<StaffRole, ResolvedPermissions> = {
  ADMIN:     ADMINISTRATOR_PROFILE,
  PRESIDENT: ADMINISTRATOR_PROFILE,
  TRESORIER: {
    administrator: false,
    areas: {
      dashboard: "read", membres: "edit", sensible: "read", adhesions: "edit", dons: "edit", evenements: "edit",
      boutique: "edit", communication: "none", actualites: "edit", comptabilite: "edit",
      reunions: "edit", materiel: "edit", site: "none", documents: "edit",
    },
  },
  SECRETAIRE: {
    administrator: false,
    areas: {
      dashboard: "read", membres: "edit", sensible: "read", adhesions: "read", dons: "none", evenements: "edit",
      boutique: "edit", communication: "edit", actualites: "edit", comptabilite: "none",
      reunions: "edit", materiel: "edit", site: "none", documents: "edit",
    },
  },
  // A volunteer with no bureau position: nothing until an administrator grants areas.
  EQUIPE: { administrator: false, areas: { ...allAreasAt("none"), dashboard: "read" } },
}

function isAccessLevel(value: unknown): value is AccessLevel {
  return value === "none" || value === "read" || value === "edit"
}

/**
 * The effective access of a user. Stored permissions win when present; otherwise the profile
 * of the role. An ADMIN is always an administrator — the role is the safety net that keeps at
 * least one account able to manage access (see the last-admin guard on role changes).
 */
export function resolvePermissions(role: string | null | undefined, stored: unknown): ResolvedPermissions {
  if (!isStaffRole(role)) return NO_ACCESS
  if (role === "ADMIN") return ADMINISTRATOR_PROFILE

  if (typeof stored !== "object" || stored === null) return ROLE_PROFILES[role]
  const storedPermissions = stored as StoredPermissions
  if (storedPermissions.administrator === true) return ADMINISTRATOR_PROFILE

  const storedAreas = (typeof storedPermissions.areas === "object" && storedPermissions.areas !== null)
    ? storedPermissions.areas as Record<string, unknown>
    : {}
  const areas = allAreasAt("none")
  for (const area of ACCESS_AREAS) {
    const storedLevel = storedAreas[area]
    if (isAccessLevel(storedLevel)) areas[area] = storedLevel
  }
  return { administrator: false, areas }
}

/** "edit" includes "read". Administrators can do everything. */
export function hasAccess(permissions: ResolvedPermissions, area: AccessArea, level: Exclude<AccessLevel, "none">): boolean {
  if (permissions.administrator) return true
  const grantedLevel = permissions.areas[area]
  return level === "read" ? grantedLevel !== "none" : grantedLevel === "edit"
}

/** Normalizes a value submitted by the team & access screen before it is stored. */
export function toStoredPermissions(permissions: ResolvedPermissions): StoredPermissions {
  if (permissions.administrator) return { administrator: true }
  return { administrator: false, areas: { ...permissions.areas } }
}

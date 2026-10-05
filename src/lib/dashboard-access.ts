// Single owner of "who may open which dashboard screen" (FORM-34). The sidebar, the help
// panel's links and the server-side page guard (requireDashboardAccess) all read this map, so
// the menu can never offer a page that would then bounce the user, nor the reverse.
// Server-safe (no React).

import { hasAccess, isStaffRole, type AccessArea, type ResolvedPermissions } from "@/lib/permissions"

export type DashboardRouteRequirement =
  // Access to one area: "read" unless `level` says "edit" — for screens that only make sense to
  // someone who can change things (their API refuses even reads without edit).
  | { area: AccessArea; level?: "read" | "edit" }
  // Belongs to no area: settings-like screens reserved to administrators.
  | { administrator: true }
  // Any staff member (the page itself shows only what the user may see).
  | { staff: true }
  // A specific role, for the rare feature whose API is still role-gated (support: ADMIN only).
  | { role: string }

// Matched by prefix ("/dashboard/finances" covers "/dashboard/finances/recettes/…"), longest
// prefix first. "/dashboard" itself is matched exactly — see canAccessDashboardPath.
export const DASHBOARD_ROUTE_ACCESS: Record<string, DashboardRouteRequirement> = {
  "/dashboard":                       { staff: true },
  // Subscription standby screens: each page checks the association's status and the role.
  "/dashboard/abonnement-suspendu":   { staff: true },
  "/dashboard/reactiver-abonnement":  { staff: true },
  "/dashboard/activite":              { area: "dashboard" },
  "/dashboard/membres":               { area: "membres" },
  // Membership forms are read through APIs that require Adhésions "edit" (see
  // GET /api/membership-forms); a "read" user works from the cotisations list instead.
  "/dashboard/adhesions":             { area: "adhesions", level: "edit" },
  "/dashboard/cotisations":           { area: "adhesions" },
  "/dashboard/dons":                  { area: "dons" },
  "/dashboard/evenements":            { area: "evenements" },
  "/dashboard/boutique":              { area: "boutique" },
  "/dashboard/messages":              { area: "communication" },
  "/dashboard/sondages":              { area: "communication" },
  "/dashboard/actualites":            { area: "actualites" },
  "/dashboard/finances":              { area: "comptabilite" },
  // Importing a bank statement writes entries: Comptabilité "edit".
  "/dashboard/finances/import":       { area: "comptabilite", level: "edit" },
  "/dashboard/devis":                 { area: "comptabilite" },
  "/dashboard/factures":              { area: "comptabilite" },
  "/dashboard/fournisseurs":          { area: "comptabilite" },
  "/dashboard/reunions":              { area: "reunions" },
  "/dashboard/materiel":              { area: "materiel" },
  "/dashboard/site":                  { area: "site" },
  "/dashboard/documents-association": { area: "documents" },
  // Administrators only, as before FORM-34 (Admin + Président): billing, Stripe, bank details,
  // integrations and team access all live there.
  "/dashboard/parametres":            { administrator: true },
  // /api/support-tickets is ADMIN-only (not every administrator), so the page is too.
  "/dashboard/suporte":               { role: "ADMIN" },
}

const ROUTE_PREFIXES_LONGEST_FIRST = Object.keys(DASHBOARD_ROUTE_ACCESS)
  .filter(routePrefix => routePrefix !== "/dashboard")
  .sort((firstPrefix, secondPrefix) => secondPrefix.length - firstPrefix.length)

/** The requirement of a dashboard path, or null for a path the map does not know. */
export function dashboardRouteRequirement(pathname: string): DashboardRouteRequirement | null {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  if (normalizedPath === "/dashboard") return DASHBOARD_ROUTE_ACCESS["/dashboard"]
  const matchingPrefix = ROUTE_PREFIXES_LONGEST_FIRST.find(routePrefix =>
    normalizedPath === routePrefix || normalizedPath.startsWith(routePrefix + "/"),
  )
  return matchingPrefix ? DASHBOARD_ROUTE_ACCESS[matchingPrefix] : null
}

export function meetsDashboardRequirement(
  permissions: ResolvedPermissions,
  role: string | null | undefined,
  requirement: DashboardRouteRequirement,
): boolean {
  if (!isStaffRole(role)) return false
  if ("area" in requirement)          return hasAccess(permissions, requirement.area, requirement.level ?? "read")
  if ("administrator" in requirement) return permissions.administrator
  if ("role" in requirement)          return role === requirement.role
  return true
}

/**
 * Whether a staff user may open a dashboard path. Unknown paths are refused (fail closed):
 * a new dashboard folder must be added to DASHBOARD_ROUTE_ACCESS to be reachable from the
 * sidebar or the help panel.
 */
export function canAccessDashboardPath(
  permissions: ResolvedPermissions,
  role: string | null | undefined,
  pathname: string,
): boolean {
  const requirement = dashboardRouteRequirement(pathname)
  return !!requirement && meetsDashboardRequirement(permissions, role, requirement)
}

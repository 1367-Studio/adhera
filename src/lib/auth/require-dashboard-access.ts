import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { resolvePermissions } from "@/lib/permissions"
import { canAccessDashboardPath } from "@/lib/dashboard-access"

/**
 * Server Components / layouts: sends the user back to the dashboard home when their access
 * (FORM-34 per-area permissions, see src/lib/dashboard-access.ts) does not include this
 * route. Pass the route prefix the layout owns, e.g. "/dashboard/finances".
 *
 * Never call it for "/dashboard" itself: that is where a refused user lands, and it is open
 * to every staff member, so no redirect loop is possible. A signed-out user is left to the
 * dashboard layout, which sends them to /login.
 */
export async function requireDashboardAccess(routePrefix: string) {
  const session = await auth()
  if (!session?.user) return
  const sessionUser = session.user as { role?: string | null; permissions?: unknown }
  const permissions = resolvePermissions(sessionUser.role, sessionUser.permissions)
  if (!canAccessDashboardPath(permissions, sessionUser.role, routePrefix)) redirect("/dashboard")
}

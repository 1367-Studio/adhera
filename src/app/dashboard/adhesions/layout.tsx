import { requireModule } from "@/lib/auth/require-module"
import { requireDashboardAccess } from "@/lib/auth/require-dashboard-access"

// Requires Adhésions "edit" (see DASHBOARD_ROUTE_ACCESS): membership forms are read through
// APIs that refuse "read" users, who work from the cotisations list instead.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess("/dashboard/adhesions")
  await requireModule("cotisations")
  return <>{children}</>
}

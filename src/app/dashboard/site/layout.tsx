import { requireModule } from "@/lib/auth/require-module"
import { requireDashboardAccess } from "@/lib/auth/require-dashboard-access"

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess("/dashboard/site")
  await requireModule("site")
  return <>{children}</>
}

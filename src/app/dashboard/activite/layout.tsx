import { requireDashboardAccess } from "@/lib/auth/require-dashboard-access"

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess("/dashboard/activite")
  return <>{children}</>
}

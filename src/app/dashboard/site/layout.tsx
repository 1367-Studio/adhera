import { requireModule } from "@/lib/auth/require-module"

// No requireDashboardAccess() here, unlike most section layouts: the three pages under this
// one need different levels (edit for the editor, read for the preview, the legacy page
// always redirects), which a single layout-wide check can't express — each page guards
// itself instead (see dashboard-access.ts for both route entries).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("site")
  return <>{children}</>
}

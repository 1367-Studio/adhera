import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { SitePagesView } from "@/components/site/site-pages-view"

export const metadata: Metadata = { title: "Pages" }

// FORM-7 "Pages": custom pages beyond the single home page, reached from the Puck editor's
// toolbar. Same guard as /dashboard/site/puck — only users who can edit the site land here.
export default async function SitePagesPage() {
  const session = await auth()
  const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "site", "edit")) redirect("/dashboard")
  return <SitePagesView />
}

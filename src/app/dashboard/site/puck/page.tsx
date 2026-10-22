import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { SitePuckEditor } from "@/components/site/puck/site-puck-editor"

export const metadata: Metadata = { title: "Site web" }

// The only site editor (FORM-7), reached from the sidebar. Only users who can edit the site
// (FORM-34 "site" area at "edit") land here — the layout already enforces this
// (dashboard-access.ts requires "edit" for the whole /dashboard/site prefix); this is just the
// same guard the layout uses, kept here too in case this page is ever reached another way.
export default async function SitePuckPage() {
  const session = await auth()
  const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "site", "edit")) redirect("/dashboard")
  return <SitePuckEditor />
}

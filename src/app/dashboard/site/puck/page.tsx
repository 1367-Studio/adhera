import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { SitePuckEditor } from "@/components/site/puck/site-puck-editor"

export const metadata: Metadata = { title: "Site web — essai Puck" }

// FORM-7 trial page, not linked from the sidebar: only the users who can edit the site (FORM-34 "site" area at "edit").
export default async function SitePuckPage() {
  const session = await auth()
  const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "site", "edit")) redirect("/dashboard/site")
  return <SitePuckEditor />
}

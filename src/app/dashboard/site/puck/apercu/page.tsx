import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { SitePuckPreview } from "@/components/site/puck/site-puck-preview"

export const metadata: Metadata = { title: "Aperçu du site" }

// Same access as the editor: only the users who can edit the site (FORM-34 "site" area at "edit").
export default async function SitePuckPreviewPage() {
  const session = await auth()
  const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "site", "edit")) redirect("/dashboard/site")
  return <SitePuckPreview />
}

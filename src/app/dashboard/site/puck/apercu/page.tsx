import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { SitePuckPreview } from "@/components/site/puck/site-puck-preview"

export const metadata: Metadata = { title: "Aperçu du site" }

// Opened from the editor ("Visualiser") by anyone who can edit the site, and the only "site"
// screen left for anyone with just "read" (FORM-34) — there is no read-only editor, so this
// content-only view (Puck's <Render>, no editor chrome) is what they land on instead.
export default async function SitePuckPreviewPage() {
  const session = await auth()
  const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "site", "read")) redirect("/dashboard")
  return <SitePuckPreview canEdit={hasAccess(permissions, "site", "edit")} />
}

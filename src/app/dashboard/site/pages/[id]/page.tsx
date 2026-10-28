import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { SitePageEditor } from "@/components/site/puck/site-page-editor"

export const metadata: Metadata = { title: "Page" }

export default async function SitePageEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "site", "edit")) redirect("/dashboard")
  return <SitePageEditor pageId={id} />
}

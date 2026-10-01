import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { SitePuckPreview } from "@/components/site/puck/site-puck-preview"

export const metadata: Metadata = { title: "Aperçu du site" }

// Same access as the editor: only the roles that can edit the site.
const SITE_EDITOR_ROLES = ["ADMIN", "PRESIDENT"]

export default async function SitePuckPreviewPage() {
  const session = await auth()
  const role    = (session?.user as { role?: string } | undefined)?.role
  if (!role || !SITE_EDITOR_ROLES.includes(role)) redirect("/dashboard/site")
  return <SitePuckPreview />
}

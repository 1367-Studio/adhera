import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { SitePuckEditor } from "@/components/site/puck/site-puck-editor"

export const metadata: Metadata = { title: "Site web — essai Puck" }

// FORM-7 trial page, not linked from the sidebar: only the roles that can edit the site.
const SITE_EDITOR_ROLES = ["ADMIN", "PRESIDENT"]

export default async function SitePuckPage() {
  const session = await auth()
  const role    = (session?.user as { role?: string } | undefined)?.role
  if (!role || !SITE_EDITOR_ROLES.includes(role)) redirect("/dashboard/site")
  return <SitePuckEditor />
}

import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"

// Creating needs "documents" edit access (same check as the POST route); a reader who
// lands here by URL goes back to the list instead of filling a form the API would refuse.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const sessionUser = session?.user as { role?: string | null; permissions?: unknown } | undefined
  if (sessionUser && !hasAccess(resolvePermissions(sessionUser.role, sessionUser.permissions), "documents", "edit")) {
    redirect("/dashboard/documents-association")
  }
  return <>{children}</>
}

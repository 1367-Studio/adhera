import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { hasAccess, resolvePermissions } from "@/lib/permissions"
import { ImportWizard } from "@/components/finances/import-wizard"

export default async function ImportPage() {
  // FORM-34: importing a bank statement only writes, so a Comptabilité reader has nothing to
  // do here (/api/finances/import refuses them) — send them back to the finances overview.
  const session     = await auth()
  const sessionUser = session?.user as { role?: string | null; permissions?: unknown } | undefined
  const permissions = resolvePermissions(sessionUser?.role, sessionUser?.permissions)
  if (!hasAccess(permissions, "comptabilite", "edit")) redirect("/dashboard/finances")

  return <ImportWizard />
}

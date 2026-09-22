import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { checkAndUpdateCustomDomainStatus } from "@/lib/vercel-domains"

const ADMINS = ["ADMIN", "PRESIDENT"]

// "Verificar agora" — purely a UX shortcut for an impatient admin. The cron sweep
// (custom-domain-verification-sweep) already re-checks every PENDING domain every 15
// minutes on its own, so this never needs to be called for the feature to work.
export const POST = withAdminAuth(async (req, ctx) => {
  const status = await checkAndUpdateCustomDomainStatus(ctx.associationId)
  if (status === null) return NextResponse.json({ error: "Aucun domaine configuré" }, { status: 404 })

  return NextResponse.json({ ok: true, status })
}, { roles: ADMINS })

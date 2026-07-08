import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"

type SessionUser = {
  id?:                 string
  role?:               string
  associationId?:      string | null
  subscriptionStatus?: string | null
}

export type AssociationCtx = {
  associationId: string
  userId:        string
  role:          string
}

export async function getAssociationCtx(
  options: { allowWhenLocked?: boolean } = {},
): Promise<AssociationCtx | NextResponse> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  // CANCELLED and SUSPENDED both mirror the hard block enforced at the page level in
  // src/proxy.ts, but the standby screen's own actions (reactivate/export/reactivate-
  // via-checkout) opt out via allowWhenLocked — those are the only things a locked-out
  // association is allowed to do.
  if ((u.subscriptionStatus === "CANCELLED" || u.subscriptionStatus === "SUSPENDED") && !options.allowWhenLocked) {
    return NextResponse.json({ error: "Subscription locked" }, { status: 403 })
  }

  return {
    associationId: u.associationId,
    userId:        u.id!,
    role:          u.role!,
  }
}

export function isCtx(v: AssociationCtx | NextResponse): v is AssociationCtx {
  return "associationId" in v
}

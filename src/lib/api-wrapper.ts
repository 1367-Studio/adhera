import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx, type AssociationCtx } from "@/lib/api-association"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import type { AssocModules } from "@/lib/modules"

type RouteContext<Params> = { params: Promise<Params> }
type Handler<Ctx, Params> = (req: Request, ctx: Ctx, params: Params) => Promise<NextResponse> | NextResponse

/**
 * Wraps a dashboard/admin API route handler: resolves association context, optionally
 * gates on a module, optionally restricts to a role allowlist. Replaces the
 * getAssociationCtx()/isCtx()/guardModule()/role-check block that used to be
 * hand-copied at the top of every admin route.
 */
export function withAdminAuth<Params = Record<string, string>>(
  handler: Handler<AssociationCtx, Params>,
  options: { roles?: readonly string[]; module?: keyof AssocModules; allowWhenLocked?: boolean } = {},
) {
  return async (req: Request, context?: RouteContext<Params>) => {
    const ctx = await getAssociationCtx({ allowWhenLocked: options.allowWhenLocked })
    if (!isCtx(ctx)) return ctx

    if (options.module) {
      const guard = await guardModule(ctx.associationId, options.module)
      if (guard) return guard
    }
    if (options.roles && !options.roles.includes(ctx.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const params = context ? await context.params : ({} as Params)
    return handler(req, ctx, params)
  }
}

export type SuperAdminCtx = { userId: string }

/**
 * Wraps a SUPER_ADMIN-only backoffice route handler. Deliberately does NOT go through
 * getAssociationCtx() — SUPER_ADMIN accounts aren't scoped to any single association
 * (their session associationId is null), and backoffice routes operate across all
 * associations, addressed by an :id param rather than the caller's own tenant.
 */
export function withSuperAdminAuth<Params = Record<string, string>>(
  handler: Handler<SuperAdminCtx, Params>,
) {
  return async (req: Request, context?: RouteContext<Params>) => {
    const session = await auth()
    const u = session?.user as { id?: string; role?: string } | undefined
    if (!u?.id || u.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 })
    }

    const params = context ? await context.params : ({} as Params)
    return handler(req, { userId: u.id }, params)
  }
}

export type PortalCtx = { userId: string; associationId: string; membreId: string | null }

/**
 * Wraps a portal (member-facing) API route handler: resolves the session, optionally
 * gates on a module, and — unless requireMembre is false — looks up the caller's own
 * Membre record (always scoped by deletedAt: null, so a soft-deleted member's session
 * can no longer act as if they were still active). Replaces the auth()/membre.findFirst
 * block that used to be hand-copied at the top of every portal route.
 */
export function withPortalAuth<Params = Record<string, string>>(
  handler: Handler<PortalCtx, Params>,
  options: { module?: keyof AssocModules; requireMembre?: boolean } = {},
) {
  const requireMembre = options.requireMembre ?? true

  return async (req: Request, context?: RouteContext<Params>) => {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const u = session.user as { id?: string; associationId?: string | null; subscriptionStatus?: string | null }
    if (!u.associationId || !u.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    // Mirrors the hard block enforced at the page level in src/proxy.ts. A member has no
    // billing actions available, so SUSPENDED is blocked the same as CANCELLED here —
    // only the association's own admin gets the standby screen with reactivate/export/cancel.
    if (u.subscriptionStatus === "CANCELLED" || u.subscriptionStatus === "SUSPENDED") {
      return NextResponse.json({ error: "Subscription cancelled" }, { status: 403 })
    }

    if (options.module) {
      const guard = await guardModule(u.associationId, options.module)
      if (guard) return guard
    }

    let membreId: string | null = null
    if (requireMembre) {
      const membre = await prisma.membre.findFirst({
        where:  { userId: u.id, associationId: u.associationId, deletedAt: null },
        select: { id: true },
      })
      if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
      membreId = membre.id
    }

    const params = context ? await context.params : ({} as Params)
    return handler(req, { userId: u.id, associationId: u.associationId, membreId }, params)
  }
}

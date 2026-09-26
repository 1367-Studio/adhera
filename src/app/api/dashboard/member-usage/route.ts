import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { getPricingInfo } from "@/lib/stripe"
import { effectiveMemberLimit } from "@/lib/plan-limits"

// Kept apart from /api/dashboard on purpose: the limit needs getPricingInfo(), which calls
// Stripe on a cache miss. A slow or failing Stripe must only hide the usage bar, never
// block the whole dashboard.
//
// No role restriction, same as /api/billing — every dashboard role can open the
// Abonnement tab this bar links to.
export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const [association, pricing, activeCount] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: associationId },
      select: { plan: true, customMemberLimit: true },
    }),
    getPricingInfo(),
    prisma.membre.count({ where: { associationId, status: "ACTIF", deletedAt: null } }),
  ])
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  return NextResponse.json({
    activeCount,
    limit: effectiveMemberLimit(association, pricing),
  })
})

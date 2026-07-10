import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { getPricingInfo } from "@/lib/stripe"
import { effectiveMemberLimit } from "@/lib/plan-limits"

export const GET = withAdminAuth(async (_req, ctx) => {
  const [assoc, pricing, memberCount] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: {
        subscriptionStatus: true, trialEndsAt: true, suspendedAt: true, stripeCustomerId: true,
        cancelAtPeriodEnd: true, currentPeriodEndsAt: true, plan: true, customMemberLimit: true,
      },
    }),
    getPricingInfo(),
    prisma.membre.count({ where: { associationId: ctx.associationId, status: "ACTIF" } }),
  ])
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const tier = assoc.plan === "PRO" ? "pro" as const : "essential" as const

  return NextResponse.json({
    subscriptionStatus:  assoc.subscriptionStatus,
    trialEndsAt:         assoc.trialEndsAt,
    suspendedAt:         assoc.suspendedAt,
    cancelAtPeriodEnd:   assoc.cancelAtPeriodEnd,
    currentPeriodEndsAt: assoc.currentPeriodEndsAt,
    hasBilling:          !!assoc.stripeCustomerId,
    plan:                tier,
    memberCount,
    memberLimit:         effectiveMemberLimit(assoc, pricing),
  })
}, { allowWhenLocked: true })

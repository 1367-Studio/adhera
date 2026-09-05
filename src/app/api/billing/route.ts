import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { getPricingInfo, customerHasPaymentMethod } from "@/lib/stripe"
import { effectiveMemberLimit } from "@/lib/plan-limits"

export const GET = withAdminAuth(async (_req, ctx) => {
  const [assoc, pricing, memberCount] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: {
        subscriptionStatus: true, trialEndsAt: true, suspendedAt: true, stripeCustomerId: true, stripeSubscriptionId: true,
        cancelAtPeriodEnd: true, currentPeriodEndsAt: true, plan: true, customMemberLimit: true,
      },
    }),
    getPricingInfo(),
    prisma.membre.count({ where: { associationId: ctx.associationId, status: "ACTIF" } }),
  ])
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const tier = assoc.plan === "PRO" ? "pro" as const : "essential" as const

  // Only asked of Stripe while trialing — the one state where "is there a card to charge
  // at the end?" changes what the settings tab tells the admin (a card-free trial is
  // cancelled by Stripe at trial end, see /api/register). null = Stripe couldn't be
  // reached; the UI then falls back to neutral wording rather than wrongly nagging about a
  // missing card.
  const hasPaymentMethod = assoc.subscriptionStatus === "TRIAL" && assoc.stripeCustomerId
    ? await customerHasPaymentMethod(assoc.stripeCustomerId, assoc.stripeSubscriptionId).catch((err: unknown) => {
        console.error("[billing] failed to check payment method for association", ctx.associationId, err)
        return null
      })
    : null

  return NextResponse.json({
    subscriptionStatus:  assoc.subscriptionStatus,
    trialEndsAt:         assoc.trialEndsAt,
    hasPaymentMethod,
    suspendedAt:         assoc.suspendedAt,
    cancelAtPeriodEnd:   assoc.cancelAtPeriodEnd,
    currentPeriodEndsAt: assoc.currentPeriodEndsAt,
    hasBilling:          !!assoc.stripeCustomerId,
    plan:                tier,
    memberCount,
    memberLimit:         effectiveMemberLimit(assoc, pricing),
  })
}, { allowWhenLocked: true })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (_req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { subscriptionStatus: true, trialEndsAt: true, suspendedAt: true, stripeCustomerId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  return NextResponse.json({
    subscriptionStatus: assoc.subscriptionStatus,
    trialEndsAt:        assoc.trialEndsAt,
    suspendedAt:        assoc.suspendedAt,
    hasBilling:          !!assoc.stripeCustomerId,
  })
}, { allowWhenSuspended: true })

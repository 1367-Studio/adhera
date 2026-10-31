import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same shape as /api/billing/reactivate/setup-intent — the Stripe customer is resolved
// server-side from the caller's own association, never from client input.
export const POST = withAdminAuth(async (_req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeCustomerId: true },
  })
  if (!assoc?.stripeCustomerId) {
    return NextResponse.json({ error: "Aucun compte de facturation trouvé" }, { status: 400 })
  }

  const setupIntent = await stripe.setupIntents.create({
    customer:             assoc.stripeCustomerId,
    payment_method_types: ["card"],
    usage:                "off_session",
  })

  return NextResponse.json({ clientSecret: setupIntent.client_secret })
}, { administrator: true, allowWhenLocked: true })

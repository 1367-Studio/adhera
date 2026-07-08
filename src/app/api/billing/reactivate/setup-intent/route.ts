import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

// Unlike /api/stripe/setup-intent (unauthenticated, used pre-signup, trusts a
// client-supplied customerId), this resolves the Stripe customer server-side from the
// caller's own association — never from client input, so an authenticated admin can't
// attach a payment method to an arbitrary Stripe customer.
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
}, { roles: ADMINS, allowWhenLocked: true })

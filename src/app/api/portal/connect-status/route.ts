import { NextResponse } from "next/server"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc?.stripeConnectId) return NextResponse.json({ enabled: false })

  try {
    const account = await stripe.accounts.retrieve(assoc.stripeConnectId)
    return NextResponse.json({ enabled: account.charges_enabled === true })
  } catch (err) {
    if (!isStaleStripeResourceError(err)) throw err
    console.error("[stripe-connect] stale/inaccessible account for association", ctx.associationId, err)
    return NextResponse.json({ enabled: false })
  }
}, { requireMembre: false })

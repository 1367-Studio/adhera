import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc?.stripeConnectId) return NextResponse.json({ enabled: false })

  const account = await stripe.accounts.retrieve(assoc.stripeConnectId)

  return NextResponse.json({ enabled: account.charges_enabled === true })
}, { requireMembre: false })

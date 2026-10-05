import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc?.stripeConnectId)
    return NextResponse.json({ error: "Compte Stripe non connecté" }, { status: 400 })

  const loginLink = await stripe.accounts.createLoginLink(assoc.stripeConnectId)

  return NextResponse.json({ url: loginLink.url })
}, { administrator: true })

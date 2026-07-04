import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, role } = ctx

  if (!ADMINS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc?.stripeConnectId)
    return NextResponse.json({ error: "Compte Stripe non connecté" }, { status: 400 })

  const loginLink = await stripe.accounts.createLoginLink(assoc.stripeConnectId)

  return NextResponse.json({ url: loginLink.url })
})

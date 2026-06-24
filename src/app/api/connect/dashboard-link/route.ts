import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { getAssociationCtx, isCtx } from "@/lib/api-association"

const ADMINS = ["ADMIN", "PRESIDENT"]

export async function POST() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
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
}

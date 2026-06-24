import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { getAssociationCtx, isCtx } from "@/lib/api-association"

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  if (!assoc.stripeConnectId)
    return NextResponse.json({ status: "not_connected" })

  const account = await stripe.accounts.retrieve(assoc.stripeConnectId)

  const status = account.charges_enabled
    ? "enabled"
    : account.details_submitted
    ? "pending"
    : "incomplete"

  return NextResponse.json({
    status,
    chargesEnabled:   account.charges_enabled,
    detailsSubmitted: account.details_submitted,
    payoutsEnabled:   account.payouts_enabled,
    requirements:     account.requirements?.currently_due ?? [],
  })
}

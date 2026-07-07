import { NextResponse } from "next/server"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  if (!assoc.stripeConnectId)
    return NextResponse.json({ status: "not_connected" })

  let account
  try {
    account = await stripe.accounts.retrieve(assoc.stripeConnectId)
  } catch (err) {
    if (!isStaleStripeResourceError(err)) throw err
    // Compte supprimé ou accès révoqué côté Stripe — distinct de "jamais connecté"
    // pour que l'admin comprenne qu'il faut reconnecter, pas configurer pour la
    // première fois. /api/connect/onboard recrée un compte propre au prochain clic.
    console.error("[stripe-connect] stale/inaccessible account for association", associationId, err)
    return NextResponse.json({ status: "invalid" })
  }

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
})

import { NextResponse } from "next/server"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

export const POST = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeCustomerId: true },
  })
  if (!assoc?.stripeCustomerId)
    return NextResponse.json({ error: "Aucun abonnement associé à ce compte" }, { status: 400 })

  // The standby screen reactivates from within itself (returnTo: "standby") so the
  // Stripe redirect lands back on a page that polls for the webhook-confirmed status
  // change, instead of bouncing through /dashboard/parametres and getting redirected
  // straight back to the standby screen while the webhook is still in flight.
  const body       = await req.json().catch(() => null) as { returnTo?: string } | null
  const returnPath = body?.returnTo === "standby"
    ? "/dashboard/abonnement-suspendu"
    : "/dashboard/parametres?tab=abonnement"
  const separator  = returnPath.includes("?") ? "&" : "?"

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   assoc.stripeCustomerId,
      return_url: `${APP_URL}${returnPath}${separator}billing=updated`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    if (isStaleStripeResourceError(err)) {
      console.error("[billing] stale/inaccessible Stripe customer for association", ctx.associationId, err)
      return NextResponse.json(
        { error: "Le compte de facturation Stripe n'est plus accessible. Contactez le support." },
        { status: 502 },
      )
    }
    // Cause la plus probable la première fois : le Customer Portal n'a pas encore
    // été configuré côté Stripe (Réglages → Facturation → Customer portal).
    console.error("[billing] failed to create billing portal session for association", ctx.associationId, err)
    return NextResponse.json(
      { error: "Impossible d'ouvrir l'espace de gestion Stripe. Vérifiez que le Customer Portal est activé dans le Dashboard Stripe (Réglages → Facturation)." },
      { status: 502 },
    )
  }
}, { roles: ADMINS, allowWhenSuspended: true })

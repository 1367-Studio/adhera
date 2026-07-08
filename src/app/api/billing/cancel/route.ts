import { NextResponse } from "next/server"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const ADMINS = ["ADMIN", "PRESIDENT"]

// The standby screen's "cancel definitively" action — an explicit, admin-initiated exit
// from SUSPENDED, distinct from Stripe's own automatic PAST_DUE → SUSPENDED transition.
// Updates the DB optimistically; the customer.subscription.deleted webhook that follows
// is idempotent and will confirm the same state.
export const POST = withAdminAuth(async (_req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeSubscriptionId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  if (assoc.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(assoc.stripeSubscriptionId)
      if (sub.status !== "canceled") {
        await stripe.subscriptions.cancel(assoc.stripeSubscriptionId)
      }
    } catch (err) {
      if (!isStaleStripeResourceError(err)) {
        console.error("[billing] failed to cancel Stripe subscription for association", ctx.associationId, err)
        return NextResponse.json({ error: "Impossible d'annuler l'abonnement Stripe. Contactez le support." }, { status: 502 })
      }
      // Subscription/customer already gone on Stripe's side — proceed to mark it cancelled locally.
    }
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { subscriptionStatus: "CANCELLED", suspendedAt: null },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SUBSCRIPTION_CANCELLED_BY_ADMIN",
    entity:        "Association",
    entityId:      ctx.associationId,
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS, allowWhenSuspended: true })

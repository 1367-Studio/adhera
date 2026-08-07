import { NextResponse } from "next/server"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const ADMINS = ["ADMIN", "PRESIDENT"]

// Undoes a cancellation scheduled via /api/billing/cancel-subscription, while the
// current billing period — and therefore the subscription itself — hasn't ended yet.
export const POST = withAdminAuth(async (_req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeSubscriptionId: true, cancelAtPeriodEnd: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  if (!assoc.cancelAtPeriodEnd)
    return NextResponse.json({ error: "Aucune annulation programmée à annuler" }, { status: 409 })
  if (!assoc.stripeSubscriptionId)
    return NextResponse.json({ error: "Aucun abonnement Stripe associé" }, { status: 409 })

  try {
    await stripe.subscriptions.update(assoc.stripeSubscriptionId, { cancel_at_period_end: false })
  } catch (err) {
    if (!isStaleStripeResourceError(err)) {
      console.error("[billing] failed to resume subscription for association", ctx.associationId, err)
      return NextResponse.json({ error: "Impossible d'annuler la résiliation programmée. Contactez le support." }, { status: 502 })
    }
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { cancelAtPeriodEnd: false },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SUBSCRIPTION_CANCEL_UNDONE",
    entity:        "Association",
    entityId:      ctx.associationId,
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })

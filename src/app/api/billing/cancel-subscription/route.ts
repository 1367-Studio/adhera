import { NextResponse } from "next/server"
import { z } from "zod"
import { stripe, isStaleStripeResourceError } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const ADMINS = ["ADMIN", "PRESIDENT"]

const CANCEL_REASONS = [
  "PRICE", "MISSING_FEATURES", "ASSOCIATION_INACTIVE", "SWITCHING_TOOL", "HARD_TO_USE", "OTHER",
] as const

const schema = z.object({
  reason:   z.enum(CANCEL_REASONS),
  feedback: z.string().trim().max(1000).optional(),
}).refine(
  (data) => data.reason !== "OTHER" || !!data.feedback?.length,
  { message: "Feedback requis pour le motif \"Autre\"", path: ["feedback"] },
)

// Self-service in-app cancellation for a trialing/active subscription — schedules the
// cancellation for the end of the current billing period instead of cancelling immediately,
// so an already-paid period stays usable and no refund is issued. Distinct from
// /api/billing/cancel, which cancels immediately and is only reachable from SUSPENDED.
export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeSubscriptionId: true, subscriptionStatus: true, cancelAtPeriodEnd: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  if (assoc.subscriptionStatus !== "TRIAL" && assoc.subscriptionStatus !== "ACTIVE")
    return NextResponse.json({ error: "Aucun abonnement actif à annuler" }, { status: 409 })
  if (!assoc.stripeSubscriptionId)
    return NextResponse.json({ error: "Aucun abonnement Stripe associé" }, { status: 409 })
  // Already scheduled — via this same button, or via the Stripe Customer Portal, which
  // reaches the same subscription object and gets synced back by the webhook just like
  // this route does. Blocking the duplicate call here avoids a second, redundant
  // SUBSCRIPTION_CANCEL_SCHEDULED entry (with a possibly misleading reason) in the churn log.
  if (assoc.cancelAtPeriodEnd)
    return NextResponse.json({ error: "Une annulation est déjà programmée pour cet abonnement" }, { status: 409 })

  try {
    await stripe.subscriptions.update(assoc.stripeSubscriptionId, { cancel_at_period_end: true })
  } catch (err) {
    if (!isStaleStripeResourceError(err)) {
      console.error("[billing] failed to schedule cancellation for association", ctx.associationId, err)
      return NextResponse.json({ error: "Impossible d'annuler l'abonnement Stripe. Contactez le support." }, { status: 502 })
    }
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { cancelAtPeriodEnd: true },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SUBSCRIPTION_CANCEL_SCHEDULED",
    entity:        "Association",
    entityId:      ctx.associationId,
    metadata:      { reason: parsed.data.reason, feedback: parsed.data.feedback ?? null },
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })

import { NextResponse } from "next/server"
import { z } from "zod"
import { stripe, toSubscriptionStatus, subscriptionPeriodEnd, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const ADMINS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  paymentMethodId: z.string(),
  plan:            z.enum(["monthly", "yearly"]),
})

// The standby screen's "Se réabonner" action, reached only once the subscription has
// actually lapsed (CANCELLED) — re-collects a card via the checkout-style flow in
// reactivate-subscription-view.tsx rather than silently reusing whatever card was on
// file before, since that card may no longer be valid by the time she comes back.
export const POST = withAdminAuth(async (req, ctx) => {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  const { paymentMethodId, plan } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { stripeCustomerId: true, subscriptionStatus: true },
  })
  if (!assoc?.stripeCustomerId) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  if (assoc.subscriptionStatus !== "CANCELLED") {
    return NextResponse.json({ error: "Aucune réactivation nécessaire" }, { status: 400 })
  }

  // Atomic claim, conditioned on the row still being CANCELLED: closes the race where a
  // double click or two open tabs both pass the check above and each create a real Stripe
  // subscription (double-charging the card). Only the request that actually flips the row
  // proceeds to call Stripe; the other gets 409 immediately. TRIAL is a placeholder here —
  // rolled back to CANCELLED below on failure, overwritten with the real status on success.
  const claim = await prisma.association.updateMany({
    where: { id: ctx.associationId, subscriptionStatus: "CANCELLED" },
    data:  { subscriptionStatus: "TRIAL" },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: "Une réactivation est déjà en cours" }, { status: 409 })
  }

  const priceId = plan === "yearly" ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY

  let subscription: Awaited<ReturnType<typeof stripe.subscriptions.create>>
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: assoc.stripeCustomerId })
    await stripe.customers.update(assoc.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })
    // No trial_period_days — this association already had its one-time trial at signup.
    subscription = await stripe.subscriptions.create({
      customer:               assoc.stripeCustomerId,
      items:                  [{ price: priceId }],
      default_payment_method: paymentMethodId,
    }, {
      // The claim above is the real defense against a double-subscribe race — this is
      // defense in depth against a network retry of this exact call landing after the
      // claim succeeded but before Stripe's response came back.
      idempotencyKey: `reactivate-sub-${ctx.associationId}-${priceId}`,
    })
  } catch {
    // Release the claim — a failed payment must not leave the account sitting on the
    // free-access TRIAL status it was just provisionally flipped to.
    await prisma.association.update({ where: { id: ctx.associationId }, data: { subscriptionStatus: "CANCELLED" } })
    return NextResponse.json({ error: "Erreur de paiement. Vérifiez vos informations." }, { status: 402 })
  }

  // Optimistic update ahead of the created/updated webhook, same pattern as
  // /api/register and /api/billing/cancel — the webhook is idempotent and will
  // confirm/correct this shortly after.
  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus:   toSubscriptionStatus(subscription.status),
      suspendedAt:          null,
      cancelAtPeriodEnd:    false,
      currentPeriodEndsAt:  subscriptionPeriodEnd(subscription),
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SUBSCRIPTION_REACTIVATED",
    entity:        "Association",
    entityId:      ctx.associationId,
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS, allowWhenLocked: true })

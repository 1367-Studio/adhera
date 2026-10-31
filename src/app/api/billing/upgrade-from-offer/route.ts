import { NextResponse } from "next/server"
import Stripe from "stripe"
import { z } from "zod"
import { stripe, toSubscriptionStatus, subscriptionPeriodEnd, priceIdFor } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { reportError } from "@/lib/monitoring"

const schema = z.object({
  paymentMethodId: z.string(),
  cycle:           z.enum(["monthly", "yearly"]),
})

// Converts a negotiated PricingOffer still billing 0€ (subscriptionAmountCents === 0,
// see the field's comment in prisma/schema.prisma) onto real Essentiel catalog pricing,
// effective immediately. Unlike /api/billing/reactivate (CANCELLED -> brand new Stripe
// subscription), this association already has a live, schedule-less subscription — we
// swap its price item in place via stripe.subscriptions.update rather than creating a
// new one. No SubscriptionSchedule involved: the one that used to manage this offer's
// free phase already auto-released (see pricing-offers.ts's closeOpenEndedPhaseAndAppend
// CatalogPrice, which requires an active schedule and can't be reused here).
export const POST = withAdminAuth(async (req, ctx) => {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  const { paymentMethodId, cycle } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: {
      stripeCustomerId:             true,
      stripeSubscriptionId:        true,
      subscriptionAmountCents:     true,
      subscriptionGracePeriodEndsAt: true,
    },
  })
  if (!assoc?.stripeCustomerId || !assoc.stripeSubscriptionId) {
    return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  }
  if (assoc.subscriptionAmountCents !== 0) {
    return NextResponse.json({ error: "Cette association n'a pas d'offre gratuite à convertir" }, { status: 400 })
  }

  // Atomic claim: only proceeds if subscriptionGracePeriodEndsAt is still set (non-null)
  // — nulling it here and restoring it on failure closes the same double-submit race that
  // /api/billing/reactivate guards against by flipping subscriptionStatus temporarily.
  const previousDeadline = assoc.subscriptionGracePeriodEndsAt
  if (previousDeadline) {
    const claim = await prisma.association.updateMany({
      where: { id: ctx.associationId, subscriptionGracePeriodEndsAt: previousDeadline },
      data:  { subscriptionGracePeriodEndsAt: null },
    })
    if (claim.count === 0) {
      return NextResponse.json({ error: "Une conversion est déjà en cours" }, { status: 409 })
    }
  }

  const priceId = priceIdFor("essential", cycle)

  let subscription: Awaited<ReturnType<typeof stripe.subscriptions.update>>
  try {
    const current = await stripe.subscriptions.retrieve(assoc.stripeSubscriptionId)
    const itemId  = current.items.data[0]?.id
    if (!itemId) throw new Error("Subscription has no item to swap")

    await stripe.paymentMethods.attach(paymentMethodId, { customer: assoc.stripeCustomerId })
    await stripe.customers.update(assoc.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    subscription = await stripe.subscriptions.update(assoc.stripeSubscriptionId, {
      items:                   [{ id: itemId, price: priceId }],
      default_payment_method:  paymentMethodId,
      proration_behavior:      "none",
      billing_cycle_anchor:    "now",
    }, {
      idempotencyKey: `upgrade-from-offer-${ctx.associationId}-${priceId}`,
    })
  } catch (error) {
    const isCardError = error instanceof Stripe.errors.StripeCardError
    if (!isCardError) {
      reportError(error, { area: "stripe", action: "billing.upgrade-from-offer", extra: { associationId: ctx.associationId } })
    }
    if (previousDeadline) {
      await prisma.association.update({ where: { id: ctx.associationId }, data: { subscriptionGracePeriodEndsAt: previousDeadline } })
    }
    // A declined/invalid card is the visitor's own problem to fix and retry — anything
    // else (the subscription's Stripe-side state, a transient API error…) is ours, so
    // telling her to "check her information" would send her looking in the wrong place.
    // reportError above already alerted us; she just needs to know it's not on her end.
    return NextResponse.json(
      { error: isCardError ? "Erreur de paiement. Vérifiez vos informations." : "Une erreur est survenue de notre côté. Contactez le support si le problème persiste." },
      { status: isCardError ? 402 : 500 },
    )
  }

  // Optimistic update ahead of the customer.subscription.updated webhook, same pattern as
  // /api/billing/reactivate — the webhook is idempotent and will confirm/correct this
  // shortly after. Also clears the stale stripeSubscriptionScheduleId, which still points
  // at the free-phase schedule that already auto-released and is never read again.
  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      subscriptionStatus:            toSubscriptionStatus(subscription.status),
      subscriptionAmountCents:       subscription.items.data[0]?.price.unit_amount ?? null,
      stripeSubscriptionScheduleId:  null,
      subscriptionGracePeriodEndsAt: null,
      suspendedAt:                   null,
      cancelAtPeriodEnd:             false,
      currentPeriodEndsAt:           subscriptionPeriodEnd(subscription),
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SUBSCRIPTION_UPGRADED_FROM_OFFER",
    entity:        "Association",
    entityId:      ctx.associationId,
    metadata:      { cycle, priceId },
  })

  return NextResponse.json({ ok: true })
}, { administrator: true, allowWhenLocked: true })

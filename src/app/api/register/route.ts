import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import type Stripe from "stripe"
import { stripe, priceIdFor, TRIAL_DAYS } from "@/lib/stripe"
import { createSubscriptionScheduleFromOffer, type OfferPhase } from "@/lib/pricing-offers"
import { generateUniqueSlug } from "@/lib/slug"
import { sendEmail } from "@/lib/mail"
import { adminWelcomeEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"
import { CURRENT_TERMS_VERSION, consentIp } from "@/lib/consent"
import { writeActivityLog } from "@/lib/activity-log"

const schema = z.object({
  associationName: z.string().min(2),
  city:            z.string().optional(),
  firstName:       z.string().min(1),
  lastName:        z.string().min(1),
  email:           z.string().email(),
  password:        z.string().min(8),
  acceptedTerms:   z.literal(true),
  // The standard signup collects no card: the trial runs without one and the admin adds
  // a payment method later from Paramètres → Abonnement (see the trial_settings below).
  // Both fields only arrive together, from the card step /api/stripe/setup-intent
  // prepared — mandatory for a custom-pricing offer, whose first phase is paid from day
  // one, and merely accepted for a catalog plan.
  customerId:      z.string().optional(),
  paymentMethodId: z.string().optional(),
  // Standard signup picks a catalog plan; a custom-pricing link (see
  // src/lib/pricing-offers.ts) supplies offerToken instead — never both.
  plan:            z.enum(["monthly", "yearly"]).optional(),
  tier:            z.enum(["essential", "pro"]).optional(),
  offerToken:      z.string().optional(),
  locale:          z.enum(["fr", "en", "pt", "pt-PT", "es"]).optional(),
}).refine(
  d => (d.offerToken != null) !== (d.plan != null && d.tier != null),
  { message: "Choisissez soit un plan, soit un lien d'offre, pas les deux." },
).refine(
  d => (d.customerId != null) === (d.paymentMethodId != null),
  { message: "Moyen de paiement incomplet." },
).refine(
  d => d.offerToken == null || d.paymentMethodId != null,
  { message: "Un moyen de paiement est requis pour cette offre." },
)

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { associationName, city, firstName, lastName, email, password, customerId: browserCustomerId, paymentMethodId, plan, tier, offerToken, locale } = parsed.data
  const acceptedIp = consentIp(req)

  // Custom-pricing signup link: claimed atomically (PENDING → USED) before anything else
  // touches Stripe or the DB, so two people opening the same link — or a retry — can't
  // both redeem it. Reverted back to PENDING in the catch block below if account creation
  // fails past this point, so a transient error doesn't permanently burn an unused link.
  let offer: { id: string; planTier: "ESSENTIAL" | "PRO"; phases: OfferPhase[]; stripeProductId: string } | null = null
  if (offerToken) {
    // Expiry is enforced here too, not just on the public lookup route (GET /api/public/
    // pricing-offers/[token]) — that route only gates what the browser renders; without
    // this check here a PENDING-but-past-expiresAt offer could still be redeemed by
    // posting directly to this endpoint after the UI had already refused to show it.
    const claim = await prisma.pricingOffer.updateMany({
      where: {
        token:  offerToken,
        status: "PENDING",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data: { status: "USED" },
    })
    if (claim.count === 0) return NextResponse.json({ error: "Ce lien n'est plus valide." }, { status: 409 })

    const found = await prisma.pricingOffer.findUnique({ where: { token: offerToken } })
    if (!found) return NextResponse.json({ error: "Ce lien n'est plus valide." }, { status: 409 })
    offer = { id: found.id, planTier: found.planTier, phases: found.phases as OfferPhase[], stripeProductId: found.stripeProductId }
  }

  // Email is only unique per-association (@@unique([email, associationId])), same as
  // login/reset — an existing portal member (or admin of another association) must be
  // able to register their own new paid association with the same address. The new
  // association below always gets a fresh id, so there's nothing to collide with here.
  const priceId = offer ? null : priceIdFor(tier!, plan === "yearly" ? "yearly" : "monthly")

  let customerId: string
  let subscriptionId: string
  let scheduleId: string | null = null
  const hasPaymentMethod = paymentMethodId != null
  // Set once a Customer has been created server-side (card-free path), so the two failure
  // paths below can delete it again instead of leaving a stray Customer behind in Stripe.
  let createdCustomerId: string | null = null
  try {
    if (browserCustomerId && paymentMethodId) {
      customerId = browserCustomerId
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      })
    } else {
      // No card step ran in the browser, so no Customer exists yet (/api/stripe/setup-intent
      // is what normally creates it, ahead of the card form) — create it here.
      const customer = await stripe.customers.create({ email: email.toLowerCase(), name: `${firstName} ${lastName}` })
      customerId = createdCustomerId = customer.id
    }

    if (offer) {
      const schedule = await createSubscriptionScheduleFromOffer({
        customerId, paymentMethodId: paymentMethodId!,
        phases:          offer.phases,
        stripeProductId: offer.stripeProductId,
        // Stable per (customer, offer): a network retry or accidental double-submit
        // returns the schedule already created instead of opening a second one — same
        // reasoning as the catalog-plan idempotency key below. A given offer can only be
        // claimed once anyway (see the atomic claim above), so there's no "changing plan
        // and resubmitting" case to worry about here.
        idempotencyKey: `register-schedule-${customerId}-${offer.id}`,
      })
      scheduleId    = schedule.id
      subscriptionId = typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription!.id
    } else {
      const subscriptionParams: Stripe.SubscriptionCreateParams = {
        customer:          customerId,
        items:             [{ price: priceId! }],
        trial_period_days: TRIAL_DAYS,
        ...(paymentMethodId
          ? { default_payment_method: paymentMethodId }
          : {
              // Card-free trial. Stripe itself cancels the subscription if the trial ends
              // with still no payment method on the customer — that arrives as
              // customer.subscription.deleted, which the webhook turns into CANCELLED
              // (locked out, "Se réabonner" path with a card). A card added meanwhile from
              // the Customer Portal becomes the customer's default and the first invoice
              // simply charges it. Not left to Stripe's default ("create_invoice"), which
              // would spin up an unpayable invoice and a PAST_DUE → SUSPENDED dunning cycle
              // for an association that never entered a card in the first place.
              trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            }),
      }
      let subscription = await stripe.subscriptions.create(subscriptionParams, {
        // Stable per (customer, plan): a network retry or accidental double-submit of this
        // same registration attempt returns the subscription already created instead of
        // opening a second one on the same customer. Changing plan and resubmitting (e.g.
        // going back a step) naturally gets a fresh key since priceId differs.
        idempotencyKey: `register-sub-${customerId}-${priceId}`,
      })
      // A prior attempt on this same (customer, plan) can have failed after creating the DB
      // records below, in which case the cleanup path further down already cancelled this
      // exact subscription — but the idempotency key above is still cached by Stripe, so a
      // retry with the same inputs would otherwise silently get that dead subscription back.
      // Detect that and force a genuinely new one instead of proceeding with a cancelled sub.
      if (subscription.status === "canceled") {
        subscription = await stripe.subscriptions.create(subscriptionParams, { idempotencyKey: `register-sub-${customerId}-${priceId}-retry-${randomUUID()}` })
      }
      subscriptionId = subscription.id
    }
  } catch (err) {
    if (offer) await prisma.pricingOffer.update({ where: { id: offer.id }, data: { status: "PENDING" } }).catch(() => {})
    if (createdCustomerId) {
      try { await stripe.customers.del(createdCustomerId) } catch (delErr) { console.error(`[register] failed to delete orphaned customer ${createdCustomerId}:`, delErr) }
    }
    // With a card in play the likely cause is the card itself (declined, 3DS abandoned…);
    // without one there's nothing the person can "check" — it's Stripe or us.
    if (hasPaymentMethod) return NextResponse.json({ error: "Erreur de paiement. Vérifiez vos informations." }, { status: 402 })
    console.error("[register] failed to create card-free trial subscription:", err)
    return NextResponse.json({ error: "Erreur lors de la création du compte. Réessayez dans un instant." }, { status: 502 })
  }

  try {
    const slug         = await generateUniqueSlug(associationName, prisma)
    const passwordHash = await bcrypt.hash(password, 12)
    const trialEndsAt  = offer ? null : new Date(Date.now() + TRIAL_DAYS * 86_400_000)

    const { association, user } = await prisma.$transaction(async (tx) => {
      const association = await tx.association.create({
        data: {
          name:                 associationName,
          slug,
          city:                 city || null,
          stripeCustomerId:     customerId,
          stripeSubscriptionId: subscriptionId,
          stripeSubscriptionScheduleId: scheduleId,
          plan:                offer ? offer.planTier : (tier === "pro" ? "PRO" : "ESSENTIAL"),
          // A custom-pricing offer's first phase is already a paid, discounted deal — it
          // replaces the standard trial rather than stacking on top of it.
          subscriptionStatus:  offer ? "ACTIVE" : "TRIAL",
          trialEndsAt,
        },
      })
      const user = await tx.user.create({
        data: {
          email:           email.toLowerCase(),
          name:            `${firstName} ${lastName}`,
          passwordHash,
          role:            "ADMIN",
          associationId:   association.id,
          termsAcceptedAt: new Date(),
          termsVersion:    CURRENT_TERMS_VERSION,
          termsAcceptedIp: acceptedIp,
        },
      })
      await tx.membre.create({
        data: {
          firstName,
          lastName,
          email:         email.toLowerCase(),
          status:        "ACTIF",
          preferredLocale: locale || null,
          associationId: association.id,
          userId:        user.id,
        },
      })
      if (offer) {
        await tx.pricingOffer.update({
          where: { id: offer.id },
          data:  { associationId: association.id, usedAt: new Date() },
        })
      }
      return { association, user }
    })

    await writeActivityLog({
      associationId: association.id, actorId: user.id, action: "ASSOCIATION_REGISTERED",
      entity: "Association", entityId: association.id, label: associationName,
      metadata: offer ? { offerId: offer.id } : { tier, billingInterval: plan },
    })

    const loginUrl = `${APP_URL}/login`
    // Awaited (not fire-and-forget) — see forgot-password/route.ts for why an un-awaited
    // promise here silently never sends on Vercel's serverless runtime.
    await sendEmail(adminWelcomeEmail({ firstName, email: email.toLowerCase(), associationName, loginUrl, trialDays: offer ? 0 : TRIAL_DAYS, hasPaymentMethod })).catch((err: unknown) => {
      console.error("[register] failed to send welcome email:", err)
    })

    return NextResponse.json({ ok: true })
  } catch {
    if (scheduleId) {
      try { await stripe.subscriptionSchedules.cancel(scheduleId) } catch (err) { console.error(`[register] failed to cancel orphaned schedule ${scheduleId}:`, err) }
    } else {
      try { await stripe.subscriptions.cancel(subscriptionId) } catch (err) { console.error(`[register] failed to cancel orphaned subscription ${subscriptionId}:`, err) }
    }
    try { await stripe.customers.del(customerId) } catch (err) { console.error(`[register] failed to delete orphaned customer ${customerId}:`, err) }
    if (offer) await prisma.pricingOffer.update({ where: { id: offer.id }, data: { status: "PENDING" } }).catch(() => {})
    return NextResponse.json({ error: "Erreur lors de la création du compte" }, { status: 500 })
  }
}

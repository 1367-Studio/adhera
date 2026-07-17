import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { stripe, priceIdFor, TRIAL_DAYS } from "@/lib/stripe"
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
  customerId:      z.string(),
  paymentMethodId: z.string(),
  plan:            z.enum(["monthly", "yearly"]),
  tier:            z.enum(["essential", "pro"]),
})

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { associationName, city, firstName, lastName, email, password, customerId, paymentMethodId, plan, tier } = parsed.data
  const acceptedIp = consentIp(req)

  // Email is only unique per-association (@@unique([email, associationId])), same as
  // login/reset — an existing portal member (or admin of another association) must be
  // able to register their own new paid association with the same address. The new
  // association below always gets a fresh id, so there's nothing to collide with here.
  const priceId = priceIdFor(tier, plan === "yearly" ? "yearly" : "monthly")

  let subscription: Awaited<ReturnType<typeof stripe.subscriptions.create>>
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })
    subscription = await stripe.subscriptions.create({
      customer:               customerId,
      items:                  [{ price: priceId }],
      trial_period_days:      TRIAL_DAYS,
      default_payment_method: paymentMethodId,
    }, {
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
      subscription = await stripe.subscriptions.create({
        customer:               customerId,
        items:                  [{ price: priceId }],
        trial_period_days:      TRIAL_DAYS,
        default_payment_method: paymentMethodId,
      }, { idempotencyKey: `register-sub-${customerId}-${priceId}-retry-${randomUUID()}` })
    }
  } catch {
    return NextResponse.json({ error: "Erreur de paiement. Vérifiez vos informations." }, { status: 402 })
  }

  try {
    const slug         = await generateUniqueSlug(associationName, prisma)
    const passwordHash = await bcrypt.hash(password, 12)
    const trialEndsAt  = new Date(Date.now() + TRIAL_DAYS * 86_400_000)

    const { association, user } = await prisma.$transaction(async (tx) => {
      const association = await tx.association.create({
        data: {
          name:                associationName,
          slug,
          city:                city || null,
          stripeCustomerId:    customerId,
          stripeSubscriptionId: subscription.id,
          plan:                tier === "pro" ? "PRO" : "ESSENTIAL",
          subscriptionStatus:  "TRIAL",
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
          associationId: association.id,
          userId:        user.id,
        },
      })
      return { association, user }
    })

    await writeActivityLog({
      associationId: association.id, actorId: user.id, action: "ASSOCIATION_REGISTERED",
      entity: "Association", entityId: association.id, label: associationName,
      metadata: { tier, billingInterval: plan },
    })

    const loginUrl = `${APP_URL}/login`
    Promise.resolve().then(async () => {
      await sendEmail(adminWelcomeEmail({ firstName, email: email.toLowerCase(), associationName, loginUrl, trialDays: TRIAL_DAYS }))
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    try { await stripe.subscriptions.cancel(subscription.id) } catch (err) { console.error(`[register] failed to cancel orphaned subscription ${subscription.id}:`, err) }
    try { await stripe.customers.del(customerId) } catch (err) { console.error(`[register] failed to delete orphaned customer ${customerId}:`, err) }
    return NextResponse.json({ error: "Erreur lors de la création du compte" }, { status: 500 })
  }
}

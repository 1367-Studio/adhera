import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { stripe, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY, TRIAL_DAYS } from "@/lib/stripe"
import { generateUniqueSlug } from "@/lib/slug"
import { sendEmail } from "@/lib/mail"
import { adminWelcomeEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"

const schema = z.object({
  associationName: z.string().min(2),
  city:            z.string().optional(),
  firstName:       z.string().min(1),
  lastName:        z.string().min(1),
  email:           z.string().email(),
  password:        z.string().min(8),
  customerId:      z.string(),
  paymentMethodId: z.string(),
  plan:            z.enum(["monthly", "yearly"]),
})

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { associationName, city, firstName, lastName, email, password, customerId, paymentMethodId, plan } = parsed.data

  // Email is only unique per-association (@@unique([email, associationId])), same as
  // login/reset — an existing portal member (or admin of another association) must be
  // able to register their own new paid association with the same address. The new
  // association below always gets a fresh id, so there's nothing to collide with here.
  const priceId = plan === "yearly" ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY

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
    })
  } catch {
    return NextResponse.json({ error: "Erreur de paiement. Vérifiez vos informations." }, { status: 402 })
  }

  try {
    const slug         = await generateUniqueSlug(associationName, prisma)
    const passwordHash = await bcrypt.hash(password, 12)
    const trialEndsAt  = new Date(Date.now() + TRIAL_DAYS * 86_400_000)

    await prisma.$transaction(async (tx) => {
      const association = await tx.association.create({
        data: {
          name:                associationName,
          slug,
          city:                city || null,
          stripeCustomerId:    customerId,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus:  "TRIAL",
          trialEndsAt,
        },
      })
      const user = await tx.user.create({
        data: {
          email:         email.toLowerCase(),
          name:          `${firstName} ${lastName}`,
          passwordHash,
          role:          "ADMIN",
          associationId: association.id,
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
    })

    const loginUrl = `${APP_URL}/login`
    Promise.resolve().then(async () => {
      await sendEmail(adminWelcomeEmail({ firstName, email: email.toLowerCase(), associationName, loginUrl, trialDays: TRIAL_DAYS }))
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    try { await stripe.subscriptions.cancel(subscription.id) } catch {}
    try { await stripe.customers.del(customerId) } catch {}
    return NextResponse.json({ error: "Erreur lors de la création du compte" }, { status: 500 })
  }
}

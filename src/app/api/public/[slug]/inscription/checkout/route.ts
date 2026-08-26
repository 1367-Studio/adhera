import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { stripe, connectAccountChargesEnabled } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { assertMemberLimit, MemberLimitReachedError, MEMBER_LIMIT_VISITOR_MESSAGE } from "@/lib/plan-limits"
import { CURRENT_TERMS_VERSION, consentIp } from "@/lib/consent"
import { APP_URL } from "@/lib/env"

const schema = z.object({
  firstName:     z.string().min(1).max(80),
  lastName:      z.string().min(1).max(80),
  email:         z.string().email(),
  phone:         z.string().max(30).optional().or(z.literal("")),
  typeId:        z.string().optional(),
  password:      z.string().min(8),
  acceptedTerms: z.literal(true),
})

// Paid variant of /api/public/[slug]/inscription — only reachable when the association
// has turned on publicMembershipPaymentEnabled (see Association in schema.prisma). Unlike
// the free-request route, no Membre is created here: a Subscription id doesn't exist
// until Stripe mints it, so there's nothing to key a row on yet. The submitted data rides
// through Stripe as subscription metadata, and handleCotisationSubscriptionCheckout
// (src/lib/webhook/cotisation-subscriptions.ts) turns it into a real Membre/User/
// CotisationSubscription once checkout.session.completed arrives.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!(await rateLimit(`inscription-checkout:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      id: true, name: true, sitePublished: true, modules: true,
      publicMembershipPaymentEnabled: true, cotisationDefaultAmount: true, stripeConnectId: true,
    },
  })
  if (!assoc || !assoc.sitePublished || !parseModules(assoc.modules).site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!assoc.publicMembershipPaymentEnabled || !assoc.cotisationDefaultAmount) {
    return NextResponse.json({ error: "Le paiement en ligne n'est pas activé pour cette association." }, { status: 400 })
  }
  if (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId))) {
    return NextResponse.json({ error: "Paiement en ligne non disponible pour le moment." }, { status: 400 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { firstName, lastName, email, phone, typeId, password } = parsed.data
  const acceptedIp = consentIp(req)

  const existing = await prisma.membre.findFirst({
    where: { associationId: assoc.id, email, deletedAt: null },
  })
  if (existing) return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })

  if (typeId) {
    const validType = await prisma.membreType.findFirst({ where: { id: typeId, associationId: assoc.id } })
    if (!validType) return NextResponse.json({ error: "Type de membre invalide." }, { status: 422 })
  }

  try {
    await assertMemberLimit(assoc.id)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: MEMBER_LIMIT_VISITOR_MESSAGE }, { status: 422 })
    throw err
  }

  // Hashed here, never sent raw to Stripe — subscription_data.metadata carries the hash
  // through to handleCotisationSubscriptionCheckout, which stamps it straight onto the
  // new User row.
  const passwordHash = await bcrypt.hash(password, 12)
  const amountCents  = Math.round(Number(assoc.cotisationDefaultAmount) * 100)

  const subscriptionMeta = {
    kind:            "cotisation",
    associationId:   assoc.id,
    firstName,
    lastName,
    email,
    phone:           phone || "",
    typeId:          typeId || "",
    passwordHash,
    termsAcceptedIp: acceptedIp ?? "",
    termsVersion:    CURRENT_TERMS_VERSION,
  }

  const successUrl = `${APP_URL}/${slug}?payment=success#adhesion`
  const cancelUrl  = `${APP_URL}/${slug}?payment=cancelled#adhesion`

  let checkoutSession
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency:     "eur",
            unit_amount:  amountCents,
            recurring:    { interval: "year" },
            product_data: { name: `Adhésion — ${assoc.name}` },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        transfer_data: { destination: assoc.stripeConnectId },
        metadata:      subscriptionMeta,
      },
      metadata:       subscriptionMeta,
      customer_email: email,
      success_url:    successUrl,
      cancel_url:     cancelUrl,
    })
  } catch (err) {
    console.error(`[inscription-checkout] Stripe session creation failed for association ${assoc.id}:`, err)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  return NextResponse.json({ url: checkoutSession.url })
}

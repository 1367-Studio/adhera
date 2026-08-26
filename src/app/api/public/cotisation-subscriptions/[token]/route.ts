import { NextResponse } from "next/server"
import Stripe from "stripe"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Self-service cancellation for recurring membership payments — accessed via the
// unguessable cancelToken emailed at subscription start and on payment failure, not a
// login. Same convention as /api/public/donation-subscriptions/[token].

async function findByToken(token: string) {
  return prisma.cotisationSubscription.findUnique({
    where:  { cancelToken: token },
    select: {
      id: true, status: true, amount: true, stripeSubscriptionId: true, associationId: true,
      membre:      { select: { firstName: true, lastName: true } },
      association: { select: { name: true } },
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`cancel-cotisation-sub-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const sub = await findByToken(token)
  if (!sub) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  return NextResponse.json({
    associationName: sub.association.name,
    firstName:       sub.membre.firstName,
    lastName:        sub.membre.lastName,
    amount:          sub.amount.toString(),
    cancelled:       sub.status === "CANCELLED",
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!(await rateLimit(`cancel-cotisation-sub:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const sub = await findByToken(token)
  if (!sub) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (sub.status === "CANCELLED")
    return NextResponse.json({ error: "Cette adhésion récurrente est déjà arrêtée." }, { status: 409 })

  // Flips the DB status here rather than waiting on the customer.subscription.deleted
  // webhook — that event can take a few seconds, and this page immediately shows a
  // "cancelled" confirmation, so the status must already be correct if the member reloads
  // or checks the link again right after confirming. The eventual webhook delivery is then
  // a harmless no-op over the same already-CANCELLED row.
  try {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
  } catch (err) {
    // Already cancelled/gone on Stripe's side (e.g. an admin cancelled it moments earlier
    // and the webhook hasn't caught up to our DB yet) — nothing left to do, so let this
    // succeed instead of showing the member a scary error for something that's already true.
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) {
      console.error(`[cancel-cotisation-subscription] Stripe cancel failed for ${sub.id}:`, err)
      return NextResponse.json({ error: "L'arrêt a échoué. Réessayez dans quelques instants ou contactez l'association." }, { status: 502 })
    }
  }

  await prisma.cotisationSubscription.update({
    where: { id: sub.id },
    data:  { status: "CANCELLED", cancelledAt: new Date() },
  })

  await writeActivityLog({
    associationId: sub.associationId,
    action:        "COTISATION_SUBSCRIPTION_CANCELLED_BY_MEMBRE",
    entity:        "CotisationSubscription",
    entityId:      sub.id,
    label:         `${sub.membre.firstName} ${sub.membre.lastName}`,
  })

  return NextResponse.json({ ok: true })
}

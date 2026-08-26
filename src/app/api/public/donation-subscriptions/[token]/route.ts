import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Self-service cancellation for recurring donations — accessed via the unguessable
// cancelToken emailed at subscription start, not a login (donors have no portal
// account). Same convention as /api/public/cancel-ticket/[token].

async function findByToken(token: string) {
  return prisma.donationSubscription.findUnique({
    where:  { cancelToken: token },
    select: {
      id: true, status: true, amount: true, interval: true, firstName: true, lastName: true,
      stripeSubscriptionId: true, associationId: true,
      donationForm: { select: { title: true } },
      association: { select: { name: true } },
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`cancel-donation-sub-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const sub = await findByToken(token)
  if (!sub) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  return NextResponse.json({
    associationName: sub.association.name,
    formTitle:       sub.donationForm.title,
    firstName:       sub.firstName,
    lastName:        sub.lastName,
    amount:          sub.amount.toString(),
    interval:        sub.interval,
    cancelled:       sub.status === "CANCELLED",
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!(await rateLimit(`cancel-donation-sub:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const sub = await findByToken(token)
  if (!sub) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (sub.status === "CANCELLED")
    return NextResponse.json({ error: "Ce don récurrent est déjà arrêté." }, { status: 409 })

  // The actual status flip happens via the customer.subscription.deleted webhook, once
  // Stripe confirms — same "webhook is the single source of truth for paid state" pattern
  // as every other money-moving action in this app. Cancelling immediately (not at period
  // end) matches what a donor clicking "stop this donation" expects.
  try {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
  } catch (err) {
    console.error(`[cancel-donation-subscription] Stripe cancel failed for ${sub.id}:`, err)
    return NextResponse.json({ error: "L'arrêt a échoué. Réessayez dans quelques instants ou contactez l'association." }, { status: 502 })
  }

  await writeActivityLog({
    associationId: sub.associationId,
    action:        "DONATION_SUBSCRIPTION_CANCELLED_BY_DONOR",
    entity:        "DonationSubscription",
    entityId:      sub.id,
    label:         `${sub.firstName} ${sub.lastName} — ${sub.donationForm.title}`,
  })

  return NextResponse.json({ ok: true })
}

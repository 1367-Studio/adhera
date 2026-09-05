import type Stripe from "stripe"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { trialEndingNoPaymentMethodEmail, trialExpiredEmail } from "@/lib/email"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"
import { customerHasPaymentMethod } from "@/lib/stripe"
import { APP_URL } from "@/lib/env"

// The platform subscription of an association that signed up without a card (see
// /api/register): Stripe runs the trial with no payment method on file and, if none gets
// added meanwhile, cancels the subscription itself at trial_end (trial_settings.
// end_behavior.missing_payment_method = "cancel"). Everything below is how the
// association hears about that — the rest of the lifecycle (CANCELLED → locked out →
// "Se réabonner" with a card) is the ordinary cancellation path in the webhook route.

// True when Stripe just ended a card-free trial for lack of a payment method — as opposed
// to an admin resigning during the trial, either scheduled (cancel_at_period_end: the
// in-app button, and the Customer Portal's default) or immediately (a Customer Portal
// configured that way — Stripe tags those cancellation_requested). `previous` is the
// association row as it stood before this event: only a TRIAL that never became ACTIVE
// can expire this way.
export function isTrialExpiry(
  sub:      Stripe.Subscription,
  previous: { subscriptionStatus: string; cancelAtPeriodEnd: boolean },
): boolean {
  if (sub.status !== "canceled") return false
  if (previous.subscriptionStatus !== "TRIAL" || previous.cancelAtPeriodEnd || sub.cancel_at_period_end) return false
  if (sub.cancellation_details?.reason === "cancellation_requested") return false
  return sub.trial_end != null
}

async function billingAdmins(associationId: string) {
  return prisma.user.findMany({
    where:  { associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
    select: { id: true, email: true },
  })
}

async function notifyAdmins(associationId: string, admins: { id: string }[], n: { title: string; body: string; link: string }) {
  await prisma.notification.createMany({
    data: admins.map(a => ({ userId: a.id, title: n.title, body: n.body, link: n.link, scope: "GESTION" as const })),
  })
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
}

// customer.subscription.trial_will_end — Stripe fires it 3 days before trial_end. Only a
// trial still without a card needs the nudge: with one on file Stripe simply invoices it
// at the end, and the settings tab already says so.
export async function handleTrialWillEnd(sub: Stripe.Subscription, stripeEventId: string) {
  // Already chose to leave — no point asking for a card.
  if (sub.cancel_at_period_end) return

  const assoc = await prisma.association.findFirst({
    where:  { stripeSubscriptionId: sub.id },
    select: { id: true, name: true, stripeCustomerId: true, trialEndsAt: true },
  })
  if (!assoc?.stripeCustomerId) return

  // Stripe unreachable → assume there is a card rather than send a "you have no card"
  // email that may well be wrong.
  const hasCard = await customerHasPaymentMethod(assoc.stripeCustomerId, sub.id).catch(() => true)
  if (hasCard) return

  // Stripe can redeliver the event — one nudge per delivery, same guard as
  // invoice.payment_failed in the webhook route.
  const alreadyNotified = await prisma.activityLog.findFirst({
    where: {
      associationId: assoc.id,
      action:        "TRIAL_ENDING_NO_PAYMENT_METHOD",
      entityId:      assoc.id,
      metadata:      { path: ["stripeEventId"], equals: stripeEventId },
    },
    select: { id: true },
  })
  if (alreadyNotified) return

  const admins = await billingAdmins(assoc.id)
  if (!admins.length) return

  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : assoc.trialEndsAt
  await writeActivityLog({
    associationId: assoc.id,
    action:        "TRIAL_ENDING_NO_PAYMENT_METHOD",
    entity:        "Association",
    entityId:      assoc.id,
    metadata:      { trialEndsAt: trialEndsAt?.toISOString() ?? null, stripeEventId },
  })

  const billingUrl = `${APP_URL}/dashboard/parametres?tab=abonnement`
  for (const admin of admins) {
    if (!admin.email) continue
    sendEmail(trialEndingNoPaymentMethodEmail({
      email:           admin.email,
      associationName: assoc.name,
      trialEndsAt,
      billingUrl,
    })).catch(() => {})
  }
  await notifyAdmins(assoc.id, admins, {
    title: "Votre essai gratuit se termine bientôt",
    body:  "Aucun moyen de paiement n'est enregistré. Ajoutez-en un pour conserver l'accès à la fin de l'essai.",
    link:  "/dashboard/parametres?tab=abonnement",
  })
}

// Called from customer.subscription.updated/deleted once isTrialExpiry() said so and the
// row has been flipped to CANCELLED + trialExpiredAt. Deduped per subscription rather than
// per event: Stripe may emit both an updated and a deleted event for the same
// cancellation, and the association only needs to hear about it once.
export async function handleTrialExpired(p: {
  associationId:        string
  associationName:      string
  stripeSubscriptionId: string
  stripeEventId:        string
}) {
  const alreadyNotified = await prisma.activityLog.findFirst({
    where: {
      associationId: p.associationId,
      action:        "TRIAL_EXPIRED",
      entityId:      p.associationId,
      metadata:      { path: ["stripeSubscriptionId"], equals: p.stripeSubscriptionId },
    },
    select: { id: true },
  })
  if (alreadyNotified) return

  await writeActivityLog({
    associationId: p.associationId,
    action:        "TRIAL_EXPIRED",
    entity:        "Association",
    entityId:      p.associationId,
    metadata:      { stripeSubscriptionId: p.stripeSubscriptionId, stripeEventId: p.stripeEventId },
  })

  const admins = await billingAdmins(p.associationId)
  if (!admins.length) return

  const subscribeUrl = `${APP_URL}/dashboard/reactiver-abonnement`
  for (const admin of admins) {
    if (!admin.email) continue
    sendEmail(trialExpiredEmail({
      email:           admin.email,
      associationName: p.associationName,
      subscribeUrl,
    })).catch(() => {})
  }
  await notifyAdmins(p.associationId, admins, {
    title: "Votre essai gratuit est terminé",
    body:  "Choisissez une formule et ajoutez un moyen de paiement pour retrouver l'accès.",
    link:  "/dashboard/reactiver-abonnement",
  })
}

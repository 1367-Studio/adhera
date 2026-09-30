import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { sendEmail } from "@/lib/mail"
import { pricingOfferPaymentMethodReminderEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { reportError } from "@/lib/monitoring"
import { APP_URL } from "@/lib/env"

const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000

export const POST = withSuperAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const offer = await prisma.pricingOffer.findUnique({
    where:  { id },
    select: { id: true, association: { select: { id: true, name: true, stripeCustomerId: true } } },
  })
  if (!offer?.association) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 })
  if (!offer.association.stripeCustomerId)
    return NextResponse.json({ error: "Cette association n'a pas de client Stripe associé" }, { status: 409 })

  // Mirrors the UI's own proactive disable (see lastNotifiedAt in pricing-offer-client.tsx) —
  // kept here too so a second admin, or a retried request, can't spam the same client.
  const lastNotification = await prisma.activityLog.findFirst({
    where:  { associationId: offer.association.id, action: "PRICING_OFFER_PAYMENT_METHOD_NOTIFIED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  if (lastNotification && Date.now() - lastNotification.createdAt.getTime() < NOTIFY_COOLDOWN_MS) {
    return NextResponse.json({ error: "Ce client a déjà été notifié il y a moins de 24h" }, { status: 429 })
  }

  const admins = await prisma.user.findMany({
    where:  { associationId: offer.association.id, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
    select: { email: true },
  })
  if (!admins.length) return NextResponse.json({ error: "Aucun administrateur actif à notifier" }, { status: 409 })

  const billingUrl = `${APP_URL}/dashboard/parametres?tab=abonnement`

  // Awaited, not fire-and-forget — an un-awaited promise here can silently never send on
  // Vercel's serverless runtime once the response has already gone out.
  await Promise.all(admins.map(admin =>
    sendEmail(pricingOfferPaymentMethodReminderEmail({
      email:           admin.email,
      associationName: offer.association!.name,
      billingUrl,
    })).catch(error => reportError(error, { area: "email", action: "pricing-offers.notify-payment-method", extra: { pricingOfferId: offer.id } }))
  ))

  await writeActivityLog({
    associationId: offer.association.id,
    actorId:       ctx.userId,
    action:        "PRICING_OFFER_PAYMENT_METHOD_NOTIFIED",
    entity:        "Association",
    entityId:      offer.association.id,
    metadata:      { pricingOfferId: offer.id, recipientEmails: admins.map(a => a.email) },
  })

  return NextResponse.json({ ok: true, notifiedCount: admins.length })
})

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { reportError } from "@/lib/monitoring"

// Manual escape hatch for a conversion stuck waiting on a payment that never comes (the
// association never added a card) — mirrors exactly what the invoice.paid webhook branch
// does automatically on a real first payment, see src/app/api/webhook/stripe/route.ts.
export const POST = withSuperAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const offer = await prisma.pricingOffer.findUnique({
    where:  { id },
    select: { id: true, association: { select: { id: true, stripeSubscriptionScheduleId: true, stripeSchedulePendingReleaseAt: true } } },
  })
  if (!offer) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 })
  if (!offer.association?.stripeSubscriptionScheduleId)
    return NextResponse.json({ error: "Aucun planning Stripe à libérer pour cette association" }, { status: 409 })
  // Only a conversion actually waiting on a payment can be force-released here — a schedule
  // deliberately kept active (converted with "release on payment" left unchecked, because
  // more negotiated phases are still planned) is out of scope for this button; that needs a
  // human decision in the Stripe Dashboard, not a one-click override.
  if (!offer.association.stripeSchedulePendingReleaseAt)
    return NextResponse.json({ error: "Aucune conversion en attente de paiement pour cette association" }, { status: 409 })

  const scheduleId = offer.association.stripeSubscriptionScheduleId

  try {
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
    if (schedule.status === "active") await stripe.subscriptionSchedules.release(scheduleId)
  } catch (err) {
    reportError(err, { area: "stripe", action: "pricing-offers.release-schedule", extra: { pricingOfferId: offer.id, scheduleId } })
    return NextResponse.json({ error: "Impossible de libérer le planning Stripe. Contactez le support." }, { status: 502 })
  }

  await prisma.association.update({
    where: { id: offer.association.id },
    data:  { stripeSubscriptionScheduleId: null, stripeSchedulePendingReleaseAt: null },
  })

  await writeActivityLog({
    associationId: offer.association.id,
    actorId:       ctx.userId,
    action:        "SUBSCRIPTION_SCHEDULE_RELEASED",
    entity:        "Association",
    entityId:      offer.association.id,
    metadata:      { pricingOfferId: offer.id, scheduleId, releasedManually: true },
  })

  return NextResponse.json({ ok: true })
})

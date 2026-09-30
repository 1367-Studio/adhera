import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { priceIdFor } from "@/lib/stripe"
import { tierFromPlan } from "@/lib/plan-tier"
import { closeOpenEndedPhaseAndAppendCatalogPrice, ScheduleConversionError } from "@/lib/pricing-offers"
import { writeActivityLog } from "@/lib/activity-log"
import { reportError } from "@/lib/monitoring"

const bodySchema = z.object({
  effectiveDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planTier:         z.enum(["STARTER", "ESSENTIAL", "PRO"]),
  billingCycle:     z.enum(["monthly", "yearly"]),
  releaseOnPayment: z.boolean(),
})

// Converts a USED PricingOffer's negotiated, still-open-ended Stripe schedule onto a
// standard catalog price — see closeOpenEndedPhaseAndAppendCatalogPrice() for the Stripe
// mechanics. Deliberately never touches Association.plan/subscriptionAmountCents here: the
// customer.subscription.updated webhook already syncs both the moment the phase transition
// actually happens on Stripe (immediately if effectiveDate is today, later otherwise).
export const POST = withSuperAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const body   = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  const { effectiveDate, planTier, billingCycle, releaseOnPayment } = parsed.data

  const offer = await prisma.pricingOffer.findUnique({
    where:  { id },
    select: {
      id: true, status: true,
      association: { select: { id: true, stripeSubscriptionScheduleId: true, stripeSchedulePendingReleaseAt: true } },
    },
  })
  if (!offer) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 })
  if (offer.status !== "USED" || !offer.association)
    return NextResponse.json({ error: "Cette offre n'est pas encore liée à une association" }, { status: 409 })
  if (!offer.association.stripeSubscriptionScheduleId)
    return NextResponse.json({ error: "Aucun planning Stripe à convertir pour cette association" }, { status: 409 })
  if (offer.association.stripeSchedulePendingReleaseAt)
    return NextResponse.json({ error: "Une conversion est déjà en attente de premier paiement pour cette association" }, { status: 409 })

  const catalogPriceId = priceIdFor(tierFromPlan(planTier), billingCycle)

  try {
    await closeOpenEndedPhaseAndAppendCatalogPrice({
      scheduleId:       offer.association.stripeSubscriptionScheduleId,
      effectiveDateStr: effectiveDate,
      catalogPriceId,
      idempotencyKey:   `convert-${offer.id}-${effectiveDate}-${planTier}-${billingCycle}`,
    })
  } catch (err) {
    if (err instanceof ScheduleConversionError) return NextResponse.json({ error: err.message }, { status: 409 })
    reportError(err, { area: "stripe", action: "pricing-offers.convert", extra: { pricingOfferId: offer.id } })
    return NextResponse.json({ error: "Impossible de modifier le planning Stripe. Contactez le support." }, { status: 502 })
  }

  await prisma.association.update({
    where: { id: offer.association.id },
    data:  { stripeSchedulePendingReleaseAt: releaseOnPayment ? new Date() : null },
  })

  await writeActivityLog({
    associationId: offer.association.id,
    actorId:       ctx.userId,
    action:        "PRICING_OFFER_CONVERTED_TO_STANDARD",
    entity:        "Association",
    entityId:      offer.association.id,
    metadata:      {
      pricingOfferId: offer.id,
      scheduleId:     offer.association.stripeSubscriptionScheduleId,
      planTier, billingCycle, effectiveDate, releaseOnPayment,
    },
  })

  return NextResponse.json({ ok: true })
})

import { stripe } from "@/lib/stripe"
import type Stripe from "stripe"

// One phase of a staff-negotiated custom pricing deal (see PricingOffer in
// schema.prisma). `months: null` is only valid on the last phase of an offer — it means
// "bill this amount every month, forever, until the subscription is cancelled". Every
// other phase bills `amountCents` exactly once, covering exactly `months` months, then
// moves on to the next phase — that's what lets a single upfront payment (e.g. 50€) cover
// a multi-month promotional period instead of being charged monthly during it.
export type OfferPhase = { amountCents: number; months: number | null }

export function validateOfferPhases(phases: unknown): phases is OfferPhase[] {
  if (!Array.isArray(phases) || phases.length === 0) return false
  return phases.every((p, i) => {
    if (typeof p !== "object" || p === null) return false
    const { amountCents, months } = p as Record<string, unknown>
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) return false
    const isLast = i === phases.length - 1
    if (months === null) return isLast
    return typeof months === "number" && Number.isInteger(months) && months > 0
  })
}

// Called once when the offer itself is created in the backoffice (not at redemption
// time) — every phase of the offer shares this single Product, so Stripe's own reporting
// doesn't end up with one throwaway Product per phase of the same deal.
export async function createOfferProduct(label: string): Promise<string> {
  const product = await stripe.products.create({
    name: `Formwise — ${label}`,
  })
  return product.id
}

function toPhaseParams(phase: OfferPhase, stripeProductId: string): Stripe.SubscriptionScheduleCreateParams.Phase {
  const recurringMonths = phase.months ?? 1
  return {
    items: [{
      price_data: {
        currency:  "eur",
        product:   stripeProductId,
        unit_amount: phase.amountCents,
        recurring: { interval: "month", interval_count: recurringMonths },
      },
    }],
    // Fixed phase: duration equals exactly one billing cycle of its own recurring price,
    // so it bills once and hands off to the next phase. Open-ended last phase: no
    // duration/end_date at all, which Stripe treats as "run forever until cancelled".
    ...(phase.months !== null ? { duration: { interval: "month" as const, interval_count: phase.months } } : {}),
  }
}

export async function createSubscriptionScheduleFromOffer({
  customerId,
  paymentMethodId,
  phases,
  stripeProductId,
  idempotencyKey,
}: {
  customerId:      string
  paymentMethodId: string
  phases:          OfferPhase[]
  stripeProductId: string
  idempotencyKey?: string
}): Promise<Stripe.SubscriptionSchedule> {
  // Stripe rejects the combination of an open-ended last phase (no duration/end_date,
  // meaning "bill forever") with end_behavior "cancel" — it needs to know when to cancel,
  // which an indefinite phase never tells it. "release" is the only valid choice there:
  // once the schedule's known phases are done, it steps aside and lets the last phase's
  // subscription keep running/billing on its own. A fully time-boxed offer (last phase
  // has a real duration) uses "cancel" instead, so access actually ends when the deal does.
  const lastPhaseIsOpenEnded = phases[phases.length - 1]?.months === null

  return stripe.subscriptionSchedules.create({
    customer:     customerId,
    start_date:   "now",
    end_behavior: lastPhaseIsOpenEnded ? "release" : "cancel",
    default_settings: {
      default_payment_method: paymentMethodId,
    },
    phases: phases.map(p => toPhaseParams(p, stripeProductId)),
  }, idempotencyKey ? { idempotencyKey } : undefined)
}

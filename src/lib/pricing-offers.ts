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
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 0) return false
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

// A payment method is only mandatory when some phase actually charges something — a fully
// free offer (every phase at 0€) never bills, so there's nothing for Stripe to collect and
// no card needs to be captured at signup.
export function offerRequiresPaymentMethod(phases: OfferPhase[]): boolean {
  return phases.some(p => p.amountCents > 0)
}

// YYYY-MM-DD only, deliberately not importing date-field.tsx's parseValue/todayValue —
// that file is "use client" and every other src/lib/*.ts module stays server-only.
function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null
}

function todayDateOnly(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export class ScheduleConversionError extends Error {}

// Converts an already-redeemed offer's schedule from its negotiated phase onto a standard
// catalog price. Scoped deliberately to the one case this app's own offers can be in: a
// still-active schedule whose current (last) phase is open-ended (see validateOfferPhases —
// only the last phase may ever be). Anything else (already has a future phase queued, not
// active anymore) is refused rather than guessed at — that needs a human looking at the
// Dashboard, not this helper silently doing something plausible-but-wrong to a client's bill.
export async function closeOpenEndedPhaseAndAppendCatalogPrice({
  scheduleId,
  effectiveDateStr,
  catalogPriceId,
  idempotencyKey,
}: {
  scheduleId:       string
  effectiveDateStr: string
  catalogPriceId:   string
  idempotencyKey?:  string
}): Promise<Stripe.SubscriptionSchedule> {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  if (schedule.status !== "active") {
    throw new ScheduleConversionError("Ce planning Stripe n'est plus actif (déjà terminé, relâché ou annulé).")
  }

  // Stripe always reports a concrete end_date on the current phase (the next renewal
  // boundary), even for a "recurring forever" phase created with no duration/iterations —
  // that's how this app's own open-ended offers keep billing after end_behavior "release"
  // hands them off to the bare subscription. So end_date being non-null is never a useful
  // signal on its own. What actually distinguishes "still the only phase, nothing queued
  // after it" from a genuine multi-phase deal still mid-negotiation is whether the current
  // phase is the LAST element in phases[] — validateOfferPhases's own invariant (only the
  // last phase may ever be open-ended) means that's always true for the case this helper
  // targets, and false whenever a later phase is already defined.
  const currentPhase = schedule.phases[schedule.phases.length - 1]
  if (!schedule.current_phase || currentPhase.start_date !== schedule.current_phase.start_date) {
    throw new ScheduleConversionError("Ce planning a d'autres phases déjà programmées après la phase en cours — vérifiez-le dans le Dashboard Stripe avant de continuer.")
  }

  const effective = parseDateOnly(effectiveDateStr)
  if (!effective) throw new ScheduleConversionError("Date invalide.")
  // DateField's min={todayValue()} already keeps this out of the past client-side — checked
  // again here since this helper is the actual trust boundary, not the form.
  if (effectiveDateStr < todayDateOnly()) {
    throw new ScheduleConversionError("La date d'effet ne peut pas être dans le passé.")
  }
  effective.setHours(12, 0, 0, 0) // midday local time, avoids day-boundary ambiguity
  const effectiveTs = Math.floor(effective.getTime() / 1000)
  // No "effective date must be after the phase's start" check here — the current phase, by
  // definition, already started at or before now, so any effectiveDateStr that isn't in the
  // past (checked above) is automatically fine, including "today" even when the phase itself
  // started earlier today.

  // Stripe's own documented pattern for closing a phase "today" uses the literal "now" on
  // both boundaries, rather than a timestamp that may already be in the past by the time
  // this request actually reaches Stripe.
  const boundary: "now" | number = effectiveDateStr === todayDateOnly() ? "now" : effectiveTs

  // Only the current + future phases are sent — Stripe never asks for already-completed
  // ones — but the current phase must be replayed in full (start_date, items): any field
  // left out is cleared, not preserved, so only `end_date` actually changes on it here.
  return stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    phases: [
      {
        start_date: currentPhase.start_date,
        end_date:   boundary,
        items: currentPhase.items.map(item => ({
          price:    typeof item.price === "string" ? item.price : item.price.id,
          quantity: item.quantity ?? 1,
        })),
        proration_behavior: "none",
      },
      {
        start_date: boundary,
        items: [{ price: catalogPriceId, quantity: 1 }],
        // No duration/end_date — a standard catalog subscription bills until cancelled,
        // same open-ended convention as this file's own "récurrente sans fin" phase above.
      },
    ],
  }, idempotencyKey ? { idempotencyKey } : undefined)
}

export async function createSubscriptionScheduleFromOffer({
  customerId,
  paymentMethodId,
  phases,
  stripeProductId,
  idempotencyKey,
}: {
  customerId:      string
  paymentMethodId?: string
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
    ...(paymentMethodId ? { default_settings: { default_payment_method: paymentMethodId } } : {}),
    phases: phases.map(p => toPhaseParams(p, stripeProductId)),
  }, idempotencyKey ? { idempotencyKey } : undefined)
}

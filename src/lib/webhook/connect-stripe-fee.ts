import Stripe from "stripe"
import { prisma } from "@/lib/prisma/client"
import { stripe, platformFeeRate, stripeFeeCents } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { reportError } from "@/lib/monitoring"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { getOrCreateDefaultCategory } from "@/lib/finance/resolve-default-category"

// Same helper as donation-subscriptions.ts / cotisation-subscriptions.ts / membership-installments.ts
// (duplicated locally per that convention, not shared).
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription
  return typeof sub === "string" ? sub : sub?.id ?? null
}

const ASSOCIATION_FEE_SELECT = { subscriptionStatus: true, subscriptionAmountCents: true } as const

// Retries a transient failure (e.g. the Supabase pooler hanging momentarily — see memory
// supabase-dev-pooler-flakiness) a few times with a short backoff before giving up. Both
// webhook handlers below call this and swallow the final failure themselves rather than
// throwing: invoice.created delays Stripe's own invoice finalization on a non-2xx response, and
// a real subscription charge missing our fee top-up is a far smaller problem than that charge
// being held up. A transient DB hiccup should recover within a couple of retries; if it still
// fails after that, reportError gives up and lets the invoice/charge proceed without the fee.
async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 300))
    }
  }
  throw lastError
}

// ─── invoice.created ────────────────────────────────────────────────────────────
//
// Subscriptions can only express application_fee_percent at creation — Stripe doesn't support
// a flat per-invoice amount there (see /connect/subscriptions#percentage-based-fees-and-fixed-
// fees), so the fixed €0.25 component of stripeFeeCents can't be captured by the percentage set
// at checkout. Setting application_fee_amount directly on the invoice overrides whatever the
// percentage would have computed (confirmed via /connect/subscriptions#subscription-invoices),
// so this recomputes the full fee (commission + Stripe's own cut) from scratch on every invoice
// and wins.
//
// Stripe only documents the "~1h before auto-finalization" window for a NEW BILLING CYCLE's
// invoice (/connect/subscriptions, trial-end section) — not for a brand-new subscription's very
// FIRST invoice, which a Checkout Session finalizes and pays essentially immediately as part of
// completing checkout (confirmed in sandbox 2026-10-02: this update consistently 400s with
// "Finalized invoices can't be updated in this way" for that first invoice). This is treated as
// an expected, non-fatal race rather than reported: reconcileConnectChargeStripeFee below
// doesn't assume this step succeeded — it recomputes the full ideal fee from the charge's real
// balance_transaction and tops up whatever's missing, so a failed update here just means a
// larger (but still fully correct) top-up happens after the fact instead of an exact amount
// upfront. This call stays as the fast-path optimization for ordinary renewal invoices, which do
// get the ~1h window and so update cleanly.
export async function applyConnectSubscriptionInvoiceFee(invoice: Stripe.Invoice): Promise<void> {
  try {
    await withRetries(() => doApplyConnectSubscriptionInvoiceFee(invoice))
  } catch (error) {
    reportError(error, { area: "stripe", action: "connect-stripe-fee.invoice-created", extra: { invoiceId: invoice.id } })
  }
}

async function doApplyConnectSubscriptionInvoiceFee(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return
  if (invoice.total <= 0) return // Fully-credited period — nothing to collect.

  const donationSub = await prisma.donationSubscription.findUnique({
    where:  { stripeSubscriptionId: subscriptionId },
    select: { association: { select: ASSOCIATION_FEE_SELECT } },
  })
  const cotisationSub = donationSub ? null : await prisma.cotisationSubscription.findUnique({
    where:  { stripeSubscriptionId: subscriptionId },
    select: { association: { select: ASSOCIATION_FEE_SELECT } },
  })
  const installmentPlan = (donationSub || cotisationSub) ? null : await prisma.cotisationInstallmentPlan.findUnique({
    where:  { stripeSubscriptionId: subscriptionId },
    select: { association: { select: ASSOCIATION_FEE_SELECT } },
  })

  const association = donationSub?.association ?? cotisationSub?.association ?? installmentPlan?.association
  if (!association) return // Not one of our Connect destination-charge subscriptions — e.g. the platform's own Association billing.

  const fee = Math.round(invoice.total * platformFeeRate(association)) + stripeFeeCents(invoice.total)
  try {
    await stripe.invoices.update(invoice.id!, { application_fee_amount: Math.min(fee, invoice.total) })
  } catch (error) {
    // A brand-new subscription's very first invoice (unlike a renewal) finalizes essentially
    // immediately as part of completing Checkout — not transient, so not worth the withRetries
    // backoff above. reconcileConnectChargeStripeFee below recomputes the full ideal fee from
    // the charge itself and tops up whatever's missing, so this is safe to just skip.
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.param === "application_fee") return
    throw error
  }
}

// ─── Booking the Stripe/platform fee as a real Expense ──────────────────────────
//
// Income is always recorded gross (see income-statement.ts) — the money the association's
// Stripe balance actually receives is net, Stripe's real processing fee and Formwise's own
// commission both deducted via application_fee_amount. Left alone, that difference just
// vanishes between the gross Income and the net payout. French accounting's principe de
// non-compensation (Code de commerce Art. L123-19) forbids netting a charge against a product
// and booking only the net as revenue, so this creates the fee as its own Expense instead —
// same pattern as any real Stripe↔accounting integration (QuickBooks, Xero, AssoConnect).
//
// Runs every time a Connect charge settles, independent of whether reconcileConnectChargeStripeFee
// found a shortfall to claw back below — the amount actually owed by the association is always
// idealFeeCents, top-up or not.
// Exported so app/api/webhook/stripe/route.ts's "charge.refunded" case can isolate exactly
// these two auto-created lines when reversing a refund — never a user's own manually-entered
// expense that happens to share the same `reference` by coincidence.
export const FEE_EXPENSE_DESCRIPTIONS = { stripeFee: "Frais Stripe", commission: "Commission Formwise" } as const

// This API version no longer exposes charge.invoice (see the "charge.refunded" case in
// app/api/webhook/stripe/route.ts, which resolves the same thing the same way) — a
// subscription/installment charge's Income.reference is always the invoice id (see
// donation-subscriptions.ts, cotisation-subscriptions.ts, membership-installments.ts), never
// the paymentIntent id. These Expense rows have to resolve to the SAME reference an eventual
// charge.refunded lookup would use for the matching Income, or the two can never be found
// together.
async function resolveFeeExpenseReference(charge: Stripe.Charge): Promise<string | null> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) return null
  const invoicePayments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit:   1,
  })
  const invoice   = invoicePayments.data[0]?.invoice
  const invoiceId = typeof invoice === "string" ? invoice : invoice?.id
  return invoiceId ?? paymentIntentId
}

async function bookConnectFeeExpense(params: {
  associationId: string
  charge:        Stripe.Charge
  eventId:       string
  realFeeCents:  number
  idealFeeCents: number
  chargeDate:    Date
}): Promise<void> {
  const { associationId, charge, eventId, realFeeCents, idealFeeCents, chargeDate } = params

  // Same idempotency shape as the shortfall reversal below — a redelivered charge.succeeded
  // must never double-book these two lines.
  const alreadyBooked = await prisma.activityLog.findFirst({
    where:  { associationId, action: "STRIPE_FEE_EXPENSE_BOOKED", entityId: charge.id },
    select: { id: true },
  })
  if (alreadyBooked) return

  const reference = await resolveFeeExpenseReference(charge)
  const exercice         = await resolveExerciceForDate(associationId, chargeDate)
  const commissionCents  = idealFeeCents - realFeeCents

  // Resolved with the plain `prisma` client, outside the transaction below — see
  // getOrCreateDefaultCategory's doc comment: its P2002-race retry needs a fresh connection to
  // recover, which a `tx` can't give it once one of its own statements has already failed.
  // Stripe's own processing fee is a real bank/card-processing charge → fraisBancaires (6278).
  // Formwise's platform commission is NOT a bank fee — it's a service/platform commission (see
  // the task's explicit "don't classify everything as a bank fee" rule) → its own category,
  // commissionFormwise (6226, Honoraires).
  const stripeFeeCategoryId = await getOrCreateDefaultCategory(prisma, associationId, "fraisBancaires")
  const commissionCategoryId = commissionCents > 0
    ? await getOrCreateDefaultCategory(prisma, associationId, "commissionFormwise")
    : null

  await prisma.$transaction(async (tx) => {
    await tx.expense.create({
      data: {
        associationId, categoryId: stripeFeeCategoryId, reference,
        exerciceId:  exercice?.id ?? null,
        amount:      realFeeCents / 100,
        date:        chargeDate,
        description: FEE_EXPENSE_DESCRIPTIONS.stripeFee,
        status:      "VALIDATED",
      },
    })
    // Associations exempt from the platform commission (TRIAL, or already on a paying plan —
    // see platformFeeRate) must never get a 0€ "Commission Formwise" line.
    if (commissionCents > 0) {
      await tx.expense.create({
        data: {
          associationId, categoryId: commissionCategoryId, reference,
          exerciceId:  exercice?.id ?? null,
          amount:      commissionCents / 100,
          date:        chargeDate,
          description: FEE_EXPENSE_DESCRIPTIONS.commission,
          status:      "VALIDATED",
        },
      })
    }
    // Written inside the same transaction as the Expense row(s) it guards — this IS the
    // idempotency check above, so it must commit atomically with what it's guarding, not as a
    // best-effort afterthought (unlike writeActivityLog's fire-and-forget rows elsewhere in
    // this file, which aren't themselves idempotency guards).
    await tx.activityLog.create({
      data: {
        associationId, action: "STRIPE_FEE_EXPENSE_BOOKED", entity: "Charge", entityId: charge.id,
        metadata: { stripeEventId: eventId, realFeeCents, idealFeeCents, commissionCents, reference },
      },
    })
  })
}

// ─── charge.succeeded ───────────────────────────────────────────────────────────
//
// stripeFeeCents() assumes a standard EEA card (1.5% + €0.25) — Stripe's real per-card fee is
// higher for premium EEA, non-EEA international, and UK cards (checked stripe.com/fr/pricing,
// 2026-10-02), and that real rate is only known from the charge's own balance_transaction,
// never before the charge happens (so it can't be baked into application_fee_amount upfront).
// This reconciles the gap after the fact: once the charge settles, compare the IDEAL fee
// (commission + Stripe's own real cut, both knowable only now) against whatever
// application_fee_amount the charge actually ended up with, and claw back any shortfall from
// the connected account's own balance via a transfer reversal (POST /v1/transfers/{id}/
// reversals) — so an association never nets out paying less than Stripe's real cost, regardless
// of card type.
//
// Comparing against the charge's ACTUAL application_fee_amount (not assuming some baseline
// estimate was already applied) is what makes this also the safety net for
// applyConnectSubscriptionInvoiceFee above: a subscription's first invoice can finalize before
// that pre-charge top-up lands (see its comment), leaving application_fee_amount at whatever
// application_fee_percent alone produced — this still catches and fully corrects that gap here,
// just as a single larger reversal instead of a precise upfront amount.
//
// A destination charge's Transfer object and its balance_transaction.fee are both computed
// asynchronously and aren't guaranteed to exist yet when charge.succeeded fires — confirmed in
// sandbox 2026-10-02: a standard EEA card has both immediately, but an international card can
// still be missing one or both a couple of seconds later. Rather than poll or drop the
// shortfall, ChargeNotSettledError is left uncaught here so it reaches the webhook route as a
// thrown error → non-2xx response → Stripe's own automatic redelivery (retries undelivered
// events for up to three days, see /webhooks/process-undelivered-events), which gives Stripe's
// own computation however long it actually needs. The ActivityLog idempotency check above makes
// every redelivery safe to repeat. Any other failure (DB hiccup, etc.) keeps the original
// behavior: a few quick local retries, then swallowed — a missing fee top-up shouldn't hold up
// the webhook indefinitely.
export async function reconcileConnectChargeStripeFee(charge: Stripe.Charge, eventId: string): Promise<void> {
  try {
    await withRetries(() => doReconcileConnectChargeStripeFee(charge, eventId))
  } catch (error) {
    if (error instanceof ChargeNotSettledError) throw error
    reportError(error, { area: "stripe", action: "connect-stripe-fee.charge-succeeded", extra: { chargeId: charge.id } })
  }
}

class ChargeNotSettledError extends Error {
  constructor(chargeId: string) {
    super(`transfer or balance_transaction not yet available for charge ${chargeId}`)
    this.name = "ChargeNotSettledError"
  }
}

async function doReconcileConnectChargeStripeFee(charge: Stripe.Charge, eventId: string): Promise<void> {
  if (!charge.transfer_data?.destination) return // Not one of our Connect destination charges.

  const destination    = charge.transfer_data.destination
  const destinationId  = typeof destination === "string" ? destination : destination.id
  const association = await prisma.association.findFirst({
    where:  { stripeConnectId: destinationId },
    select: { id: true, ...ASSOCIATION_FEE_SELECT },
  })
  if (!association) return

  // Idempotent against Stripe redelivering charge.succeeded for the same charge.
  const alreadyReconciled = await prisma.activityLog.findFirst({
    where:  { associationId: association.id, action: "STRIPE_FEE_SHORTFALL_RECOVERED", entityId: charge.id },
    select: { id: true },
  })
  if (alreadyReconciled) return

  // Re-fetch fresh rather than trust the webhook payload's own `charge` — confirmed in sandbox
  // 2026-10-02 that charge.succeeded's own payload can still have `transfer: undefined` (the
  // destination charge's Transfer object isn't guaranteed to exist the instant the charge
  // succeeds), on top of `balance_transaction` lagging the same way. Both settle moments later.
  const fullCharge = await stripe.charges.retrieve(charge.id, { expand: ["balance_transaction"] })
  if (!fullCharge.transfer) throw new ChargeNotSettledError(charge.id)
  const balanceTransaction = fullCharge.balance_transaction
  if (!balanceTransaction || typeof balanceTransaction === "string") throw new ChargeNotSettledError(charge.id)

  const realFeeCents  = balanceTransaction.fee
  // The commission component is recomputed fresh rather than reusing whatever
  // application_fee_percent produced on a subscription invoice — not needed for correctness
  // (percent-of-amount is exact either way) but keeps this one formula the single definition of
  // "ideal fee" for both one-off and subscription charges.
  const idealFeeCents   = Math.round(charge.amount * platformFeeRate(association)) + realFeeCents
  const appliedFeeCents = charge.application_fee_amount ?? 0
  const shortfallCents  = idealFeeCents - appliedFeeCents

  await bookConnectFeeExpense({
    associationId: association.id,
    charge:        fullCharge,
    eventId,
    realFeeCents,
    idealFeeCents,
    chargeDate: new Date(fullCharge.created * 1000),
  })

  if (shortfallCents <= 0) return // Already fully covered upfront — standard EEA card, no commission owed, or both.

  const transferId = typeof fullCharge.transfer === "string" ? fullCharge.transfer : fullCharge.transfer.id
  // Idempotency key, not just the ActivityLog check above: that check only guards against a
  // redelivery finding the log row already written. If the process dies between the Stripe
  // call succeeding and that write landing, a redelivery would pass the check again and double-
  // reverse the same shortfall. Keying on charge.id makes the Stripe call itself safe to repeat.
  await stripe.transfers.createReversal(transferId, {
    amount:      shortfallCents,
    description: `Stripe fee shortfall recovery for charge ${charge.id} (ideal ${idealFeeCents}c vs applied ${appliedFeeCents}c)`,
  }, {
    idempotencyKey: `stripe-fee-shortfall-${charge.id}`,
  })

  await writeActivityLog({
    associationId: association.id,
    action:        "STRIPE_FEE_SHORTFALL_RECOVERED",
    entity:        "Charge",
    entityId:      charge.id,
    metadata:      { stripeEventId: eventId, realFeeCents, idealFeeCents, appliedFeeCents, shortfallCents },
  })
}

// ─── Refunding a charge that already had a fee shortfall reversed ─────────────────
//
// A normal refund asks Stripe to reverse_transfer "proportionally to the amount being
// refunded" (confirmed via `stripe docs api "POST /v1/refunds"`) — computed against the
// ORIGINAL transfer amount. If reconcileConnectChargeStripeFee already reversed part of that
// same transfer (a non-standard card), the proportional amount a full/partial refund asks for
// no longer fits what's left, and Stripe rejects it outright (see reversals: "trying to reverse
// more money than is left on a transfer"). That would block the payer's refund entirely over an
// internal accounting conflict that isn't their fault.
//
// The payer being refunded in full is never actually at risk here — refunds.create draws from
// the PLATFORM's own balance (the platform captured the original charge), completely
// independent of whatever the connected account currently holds. So this only ever needs to
// special-case the SEPARATE, internal step of clawing back the connected account's share:
// refund the payer first (always succeeds), then — only when a prior shortfall reversal is on
// record for this charge — compute what's still safe to reverse ourselves instead of letting
// Stripe's proportional math collide with it.
export async function refundConnectCharge(params: {
  associationId:   string
  paymentIntentId: string
  amountCents:     number
  idempotencyKey:  string
  metadata?:       Stripe.MetadataParam
}): Promise<Stripe.Refund> {
  const { associationId, paymentIntentId, amountCents, idempotencyKey, metadata } = params

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] })
  const charge = typeof paymentIntent.latest_charge === "string" ? null : paymentIntent.latest_charge

  const hadShortfall = charge
    ? (await prisma.activityLog.findFirst({
        where:  { associationId, action: "STRIPE_FEE_SHORTFALL_RECOVERED", entityId: charge.id },
        select: { id: true },
      })) != null
    : false

  if (!hadShortfall) {
    return stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountCents, reverse_transfer: true, refund_application_fee: true, ...(metadata && { metadata }) },
      { idempotencyKey },
    )
  }

  // No reverse_transfer/refund_application_fee here: Stripe requires reverse_transfer whenever
  // refund_application_fee is set on a charge with an associated transfer, and reverse_transfer
  // would reverse proportionally to the transfer's ORIGINAL amount — exactly the amount that's
  // no longer fully available once reconcileConnectChargeStripeFee has already reversed part of
  // it. The transfers.createReversal call below handles both the transfer and its application
  // fee instead, proportional to what's actually being reversed now.
  const refund = await stripe.refunds.create(
    { payment_intent: paymentIntentId, amount: amountCents, ...(metadata && { metadata }) },
    { idempotencyKey },
  )

  if (charge?.transfer) {
    try {
      const transferId = typeof charge.transfer === "string" ? charge.transfer : charge.transfer.id
      const transfer    = await stripe.transfers.retrieve(transferId)
      // Same proportional formula Stripe itself would have used, but capped at what's
      // actually still unreversed — exact for a full refund (proportional == the whole
      // transfer == exactly what's left), a safe best-effort for a partial one.
      const proportional = Math.round(transfer.amount * (amountCents / charge.amount))
      const remaining    = transfer.amount - transfer.amount_reversed
      const reverseAmount = Math.min(proportional, remaining)
      if (reverseAmount > 0) {
        await stripe.transfers.createReversal(
          transferId,
          { amount: reverseAmount, refund_application_fee: true },
          { idempotencyKey: `${idempotencyKey}-shortfall-cap` },
        )
      }
    } catch (error) {
      // The payer is already refunded above — this only affects how much comes back from the
      // association, so it's logged for manual follow-up rather than failing the refund.
      reportError(error, { area: "stripe", action: "connect-stripe-fee.refund-shortfall-cap", extra: { associationId, paymentIntentId } })
    }
  }

  return refund
}

import type { SubscriptionStatus } from "@prisma/client"
import Stripe from "stripe"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia" as never,
  // Lets the SDK transparently retry transient network failures (timeouts, connection
  // resets) with its own generated idempotency key, instead of a blip surfacing as a raw
  // error to someone mid-payment.
  maxNetworkRetries: 2,
})

// Legacy single-product prices — associations created before the Essentiel/Pro split
// (see PLAN_PRICES below) still bill on these and are never migrated onto a new Price
// automatically (see scripts/migrate-existing-associations-to-tier.ts).
export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY!
export const STRIPE_PRICE_YEARLY  = process.env.STRIPE_PRICE_YEARLY!
export const TRIAL_DAYS           = 15

// Platform commission on Connect destination charges (cotisations, dons, tickets,
// boutique, adhésion) — single source so every checkout route computes the same fee.
export const PLATFORM_FEE = 0.01

// The fee only applies to associations not current on their own Formwise subscription
// (ESSENTIAL/PRO mensalidade) — TRIAL always pays 0%, PAST_DUE/SUSPENDED/CANCELLED always
// pay PLATFORM_FEE. ACTIVE pays 0% only when actually billing something: a PricingOffer
// whose current phase is 0€ forever (see src/lib/pricing-offers.ts) also reports ACTIVE on
// Stripe, but isn't "paying" in the sense this rule cares about, so it pays the fee like a
// delinquent association would. subscriptionAmountCents is synced from Stripe on every
// customer.subscription.created/updated event (src/app/api/webhook/stripe/route.ts) —
// null there (no subscription synced yet) defaults to exempt, same as a normal paying
// ACTIVE association, rather than assuming the worst about a state that shouldn't occur.
// Checked against the association's status at checkout time.
export function platformFeeRate(association: { subscriptionStatus: SubscriptionStatus; subscriptionAmountCents: number | null }): number {
  if (association.subscriptionStatus === "TRIAL") return 0
  if (association.subscriptionStatus !== "ACTIVE") return PLATFORM_FEE
  return association.subscriptionAmountCents === 0 ? PLATFORM_FEE : 0
}

// Stripe's own processing fee for the platform's real European-card traffic, confirmed
// empirically against 15 real production balance_transactions on 2026-10-01 (see
// scripts/check-real-stripe-fee-rate.ts) — fits 1.5% + €0.25 exactly across all amounts.
// On a Connect destination charge this fee is always deducted from the PLATFORM's own Stripe
// balance, never the connected account's — on_behalf_of does not change that (confirmed via
// Stripe's own docs and a sandbox reproduction, see memory stripe-connect-on-behalf-of-fee-fix).
// The only way to make an association actually bear it is to fold it into application_fee: we
// collect it on top of whatever platformFeeRate() commission already applies, every
// transaction, regardless of the association's commission-exemption status — this is Stripe's
// real cost, not a Formwise commission, so it's recovered unconditionally.
export const STRIPE_FEE_PERCENT      = 0.015
export const STRIPE_FEE_FIXED_CENTS  = 25

export function stripeFeeCents(amountCents: number): number {
  return Math.round(amountCents * STRIPE_FEE_PERCENT) + STRIPE_FEE_FIXED_CENTS
}

export type PlanTier   = "starter" | "essential" | "pro"
export type BillingCycle = "monthly" | "yearly"

export const PLAN_PRICES: Record<PlanTier, Record<BillingCycle, string>> = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY!,
    yearly:  process.env.STRIPE_PRICE_STARTER_YEARLY!,
  },
  essential: {
    monthly: process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY!,
    yearly:  process.env.STRIPE_PRICE_ESSENTIAL_YEARLY!,
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY!,
    yearly:  process.env.STRIPE_PRICE_PRO_YEARLY!,
  },
}

export function priceIdFor(tier: PlanTier, cycle: BillingCycle): string {
  return PLAN_PRICES[tier][cycle]
}

// Reverse lookup used by the webhook to sync Association.plan when an admin switches
// tier from the Stripe Customer Portal — built once per module load since PLAN_PRICES
// itself never changes at runtime.
const PRICE_ID_TO_TIER: Record<string, PlanTier> = Object.fromEntries(
  (Object.entries(PLAN_PRICES) as [PlanTier, Record<BillingCycle, string>][])
    .flatMap(([tier, cycles]) => Object.values(cycles).map(priceId => [priceId, tier]))
)

export function tierForPriceId(priceId: string): PlanTier | null {
  return PRICE_ID_TO_TIER[priceId] ?? null
}

export function toSubscriptionStatus(status: Stripe.Subscription.Status) {
  if (status === "trialing") return "TRIAL"     as const
  if (status === "active")   return "ACTIVE"    as const
  if (status === "past_due") return "PAST_DUE"  as const
  if (status === "unpaid")   return "SUSPENDED" as const
  return "CANCELLED" as const
}

// `current_period_end` moved off the top-level Subscription object onto each
// subscription item in this API version — read it from the first (and, for this
// app's single-price subscriptions, only) item.
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const unix = sub.items.data[0]?.current_period_end
  return unix ? new Date(unix * 1000) : null
}

// Whether Stripe has a card it would charge for this association's next platform
// invoice: the customer-level default (what the Customer Portal's "add a payment method"
// sets, and what /api/register sets when a card is collected) or, failing that, the
// subscription's own default. Only meaningful during a card-free trial (see
// /api/register): with nothing on file, Stripe cancels the subscription at trial end
// instead of invoicing, so the settings tab and the trial_will_end webhook both need to
// know which of the two is coming.
export async function customerHasPaymentMethod(customerId: string, subscriptionId?: string | null): Promise<boolean> {
  const customer = await stripe.customers.retrieve(customerId)
  if (customer.deleted) return false
  if (customer.invoice_settings.default_payment_method || customer.default_source) return true
  if (!subscriptionId) return false
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  return !!sub.default_payment_method
}

// Whether this subscription's latest invoice is still mid-settlement — true for a SEPA
// Direct Debit mandate that was just confirmed (card settles near-instantly, SEPA takes a
// few business days). Purely cosmetic signal for the past-due banner and settings-tab badge.
//
// A SEPA debit can still be "processing" while the invoice (and so the subscription) is
// already PAST_DUE — e.g. a prior attempt genuinely failed, the admin fixed her payment
// method, and the retry is now in flight but hasn't settled yet. "Invoice open + unpaid"
// alone can't tell that case apart from "attempt failed, nothing retrying" (both look like
// an open, unpaid invoice), so this checks the actual PaymentIntent behind the invoice's
// current payment attempt via the InvoicePayments API instead: only a genuinely in-flight
// attempt ("processing") counts as pending — a failed one reports a different status
// (requires_payment_method, requires_action, canceled, ...) and correctly falls through to
// the "needs action" banner.
async function subscriptionPaymentPendingUncached(subscriptionId: string): Promise<boolean> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id
  if (!invoiceId) return false

  // Not `limit: 1` — a retried invoice can carry more than one InvoicePayment (a canceled
  // attempt from an earlier failure, then a fresh one for the current retry), and the list
  // isn't documented to come back in a particular order. `is_default` is the one field
  // Stripe guarantees points at the attempt it's actually collecting right now.
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: "open", limit: 10 })
  const payment = payments.data.find(p => p.is_default) ?? payments.data[0]
  if (!payment) return false

  const paymentIntentId = typeof payment.payment.payment_intent === "string"
    ? payment.payment.payment_intent
    : payment.payment.payment_intent?.id
  if (!paymentIntentId) return false

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  return paymentIntent.status === "processing"
}

// Cached in-process for a minute, keyed per subscriptionId — this is 3 live Stripe calls,
// and without it every dashboard page view (every team member) and every backoffice page
// view re-runs them for the same subscription. A minute of staleness is a non-issue for a
// cosmetic "still settling" banner.
//
// Plain in-memory Map, not Next's unstable_cache: this module is imported by one-off scripts
// (scripts/*.ts, run via tsx outside any Next.js request) as well as route handlers and
// Server Components, and unstable_cache throws ("incrementalCache missing") the moment it's
// invoked outside an actual Next.js request context. A Map has no such requirement — on
// Vercel it only caches within a single warm instance (Fluid Compute can reuse one across
// requests), which is a fine, simple approximation for a cosmetic signal like this one.
const paymentPendingCache: Map<string, { value: boolean; expiresAt: number }> = new Map()
const PAYMENT_PENDING_CACHE_TTL_MS = 60_000

export async function subscriptionPaymentPending(subscriptionId: string): Promise<boolean> {
  const cached = paymentPendingCache.get(subscriptionId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const value = await subscriptionPaymentPendingUncached(subscriptionId)
  paymentPendingCache.set(subscriptionId, { value, expiresAt: Date.now() + PAYMENT_PENDING_CACHE_TTL_MS })
  return value
}

// Checks many subscriptions at once with bounded concurrency — a mass-dunning event (a
// Stripe-wide card issue, say) could otherwise put dozens of PAST_DUE associations through
// subscriptionPaymentPending's 3 Stripe calls each in one giant Promise.all, right as a
// backoffice page is exactly what an admin opens first to triage the incident.
const PENDING_CHECK_CONCURRENCY = 10

export async function subscriptionsPaymentPending(subscriptionIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>()
  for (let i = 0; i < subscriptionIds.length; i += PENDING_CHECK_CONCURRENCY) {
    const batch = subscriptionIds.slice(i, i + PENDING_CHECK_CONCURRENCY)
    const pending = await Promise.all(batch.map(id => subscriptionPaymentPending(id).catch(() => false)))
    batch.forEach((id, idx) => result.set(id, pending[idx]))
  }
  return result
}

// DonationTier.interval (MONTH | QUARTER | YEAR) → Stripe's own recurring-price shape,
// which only knows day/week/month/year — a quarter is a month billed every 3rd cycle,
// not a native Stripe interval.
export function stripeRecurringInterval(interval: "MONTH" | "QUARTER" | "YEAR"): { interval: "month" | "year"; interval_count: number } {
  if (interval === "YEAR")    return { interval: "year",  interval_count: 1 }
  if (interval === "QUARTER") return { interval: "month", interval_count: 3 }
  return { interval: "month", interval_count: 1 }
}

export type PlanPricing = {
  monthlyAmountCents: number
  yearlyAmountCents:  number
  // Read from the Price's own metadata.memberLimit (set by scripts/stripe-setup-tiers.ts)
  // rather than duplicated as a constant here — same "never hardcode, Stripe is the
  // source of truth" reasoning as the amounts themselves.
  memberLimit:        number
}

export type PricingInfo = {
  trialDays: number
  plans:     Record<PlanTier, PlanPricing>
}

let pricingCache: { data: PricingInfo; expiresAt: number } | null = null
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000

function toPlanPricing(monthly: Stripe.Price, yearly: Stripe.Price): PlanPricing {
  return {
    monthlyAmountCents: monthly.unit_amount ?? 0,
    yearlyAmountCents:  yearly.unit_amount ?? 0,
    memberLimit:        Number(monthly.metadata.memberLimit ?? yearly.metadata.memberLimit ?? 0),
  }
}

// Fetched live from the actual Stripe Price objects, never hardcoded — so the register
// page, the welcome email and the real checkout can't drift from each other. This is
// exactly the kind of mismatch that happened when the yearly Price was briefly configured
// at 29,90 €/an instead of 358,80 €/an: nothing would have caught the UI still saying one
// number while Stripe charged another.
export async function getPricingInfo(): Promise<PricingInfo> {
  if (pricingCache && pricingCache.expiresAt > Date.now()) return pricingCache.data

  const [starterMonthly,starterYearly,essentialMonthly, essentialYearly, proMonthly, proYearly] = await Promise.all([
    stripe.prices.retrieve(PLAN_PRICES.starter.monthly),
    stripe.prices.retrieve(PLAN_PRICES.starter.yearly),
    stripe.prices.retrieve(PLAN_PRICES.essential.monthly),
    stripe.prices.retrieve(PLAN_PRICES.essential.yearly),
    stripe.prices.retrieve(PLAN_PRICES.pro.monthly),
    stripe.prices.retrieve(PLAN_PRICES.pro.yearly),
  ])

  const data: PricingInfo = {
    trialDays: TRIAL_DAYS,
    plans: {
      starter: toPlanPricing(starterMonthly, starterYearly),
      essential: toPlanPricing(essentialMonthly, essentialYearly),
      pro:       toPlanPricing(proMonthly, proYearly),
    },
  }
  pricingCache = { data, expiresAt: Date.now() + PRICING_CACHE_TTL_MS }
  return data
}

// Distingue "cette ressource Stripe (compte Connect, customer...) n'est plus
// accessible" (supprimée, accès révoqué, ID d'un autre compte plateforme après
// rotation de clé...) d'une simple panne réseau/API transitoire. Seul le premier
// cas doit être traité comme "reconnexion nécessaire" — le second doit remonter
// comme une vraie erreur au lieu d'être silencieusement masqué.
export function isStaleStripeResourceError(err: unknown): boolean {
  if (err instanceof Stripe.errors.StripePermissionError) return true
  if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") return true
  return false
}

// `stripeConnectId` is set as soon as the Express account is created (see
// /api/connect/onboard), before onboarding actually finishes — checking it alone isn't
// enough to know the association can take payments right now. Also re-checked here
// (rather than cached) since Stripe can restrict a previously-enabled account later.
export async function connectAccountChargesEnabled(stripeConnectId: string): Promise<boolean> {
  try {
    const account = await stripe.accounts.retrieve(stripeConnectId)
    return !!account.charges_enabled
  } catch (err) {
    if (!isStaleStripeResourceError(err)) throw err
    console.error("[stripe-connect] stale/inaccessible account, treating as charges disabled:", stripeConnectId, err)
    return false
  }
}

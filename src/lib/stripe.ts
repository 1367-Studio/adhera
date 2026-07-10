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

export type PlanTier   = "essential" | "pro"
export type BillingCycle = "monthly" | "yearly"

export const PLAN_PRICES: Record<PlanTier, Record<BillingCycle, string>> = {
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

// Platform commission on Connect destination charges (cotisations, dons, tickets,
// boutique) — single source so every checkout route computes the same fee.
export const PLATFORM_FEE = 0.015

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

  const [essentialMonthly, essentialYearly, proMonthly, proYearly] = await Promise.all([
    stripe.prices.retrieve(PLAN_PRICES.essential.monthly),
    stripe.prices.retrieve(PLAN_PRICES.essential.yearly),
    stripe.prices.retrieve(PLAN_PRICES.pro.monthly),
    stripe.prices.retrieve(PLAN_PRICES.pro.yearly),
  ])

  const data: PricingInfo = {
    trialDays: TRIAL_DAYS,
    plans: {
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

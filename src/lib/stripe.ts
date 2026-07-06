import Stripe from "stripe"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia" as never,
})

export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY!
export const STRIPE_PRICE_YEARLY  = process.env.STRIPE_PRICE_YEARLY!
export const TRIAL_DAYS           = 20

// `stripeConnectId` is set as soon as the Express account is created (see
// /api/connect/onboard), before onboarding actually finishes — checking it alone isn't
// enough to know the association can take payments right now. Also re-checked here
// (rather than cached) since Stripe can restrict a previously-enabled account later.
export async function connectAccountChargesEnabled(stripeConnectId: string): Promise<boolean> {
  const account = await stripe.accounts.retrieve(stripeConnectId)
  return !!account.charges_enabled
}

import Stripe from "stripe"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia" as never,
})

export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY!
export const STRIPE_PRICE_YEARLY  = process.env.STRIPE_PRICE_YEARLY!
export const TRIAL_DAYS           = 20

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

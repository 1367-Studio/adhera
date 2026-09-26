// One-off setup script: creates the Essentiel/Pro Stripe Products + Prices and enables
// self-service plan switching in the Customer Portal. Safe to re-run — everything is
// looked up by name/lookup_key first, so a second run reuses what already exists instead
// of creating duplicates.
//
// Usage:
//   npx tsx scripts/stripe-setup-tiers.ts            (refuses to run against a live key)
//   npx tsx scripts/stripe-setup-tiers.ts --yes-live  (required to run against sk_live_*)
import * as dotenv from "dotenv"
import Stripe from "stripe"

dotenv.config({ path: ".env.local" })

const LIVE_CONFIRM_FLAG = "--yes-live"

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set")
  process.exit(1)
}
if (key.startsWith("sk_live_") && !process.argv.includes(LIVE_CONFIRM_FLAG)) {
  console.error(
    `STRIPE_SECRET_KEY is a LIVE key. Re-run with ${LIVE_CONFIRM_FLAG} once you've verified this in test mode first.`
  )
  process.exit(1)
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" as never })

type TierDef = {
  lookupPrefix: string
  productName:  string
  memberLimit:  number
  monthly:      number // euros
  yearly:       number // euros
}

const TIERS: TierDef[] = [
  { lookupPrefix: "adhera_starter",   productName: "Formwise - Starter", memberLimit: 30, monthly: 14.9, yearly: 149.9 },
  { lookupPrefix: "adhera_essential", productName: "Formwise — Essentiel", memberLimit: 150, monthly: 39.9, yearly: 399 },
  { lookupPrefix: "adhera_pro",       productName: "Formwise — Pro",       memberLimit: 600, monthly: 69.9, yearly: 699 },
]

async function findOrCreateProduct(name: string): Promise<Stripe.Product> {
  const existing = await stripe.products.search({ query: `name:'${name}' AND active:'true'` })
  if (existing.data[0]) {
    console.log(`Product "${name}" already exists (${existing.data[0].id}), reusing.`)
    return existing.data[0]
  }
  const product = await stripe.products.create({ name })
  console.log(`Created product "${name}" (${product.id})`)
  return product
}

// The product is only resolved when a price actually has to be created: products.search is
// eventually consistent, so resolving it up front created a duplicate empty product on every
// re-run even though the prices (found by lookup_key) already existed.
async function findOrCreatePrice(
  resolveProduct: () => Promise<Stripe.Product>,
  lookupKey: string,
  amountEuros: number,
  interval: "month" | "year",
  memberLimit: number,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })
  if (existing.data[0]) {
    console.log(`Price "${lookupKey}" already exists (${existing.data[0].id}), reusing.`)
    return existing.data[0]
  }
  const product = await resolveProduct()
  const price = await stripe.prices.create({
    product:     product.id,
    currency:    "eur",
    unit_amount: Math.round(amountEuros * 100),
    recurring:   { interval },
    lookup_key:  lookupKey,
    metadata:    { memberLimit: String(memberLimit) },
  })
  console.log(`Created price "${lookupKey}" (${price.id}) — ${amountEuros}€/${interval}`)
  return price
}

async function main() {
  const envLines: string[] = []
  const portalProducts: { product: string; prices: string[] }[] = []

  for (const tier of TIERS) {
    let productPromise: Promise<Stripe.Product> | null = null
    const resolveProduct = () => (productPromise ??= findOrCreateProduct(tier.productName))
    const monthly = await findOrCreatePrice(resolveProduct, `${tier.lookupPrefix}_monthly`, tier.monthly, "month", tier.memberLimit)
    const yearly  = await findOrCreatePrice(resolveProduct, `${tier.lookupPrefix}_yearly`,  tier.yearly,  "year",  tier.memberLimit)

    const envPrefix = tier.lookupPrefix.toUpperCase() // ADHERA_ESSENTIAL / ADHERA_PRO
    envLines.push(`STRIPE_PRICE_${envPrefix.replace("ADHERA_", "")}_MONTHLY="${monthly.id}"`)
    envLines.push(`STRIPE_PRICE_${envPrefix.replace("ADHERA_", "")}_YEARLY="${yearly.id}"`)

    // The billing portal rejects a price listed under any product but its own.
    const pricesProductId = typeof monthly.product === "string" ? monthly.product : monthly.product.id
    portalProducts.push({ product: pricesProductId, prices: [monthly.id, yearly.id] })
  }

  // Billing Portal: enable self-service plan switching between the tiers above. This is
  // what makes "Gérer mon abonnement" (already wired in billing-settings.tsx) let an admin
  // upgrade/downgrade — Stripe handles proration, and our webhook already listens for
  // customer.subscription.updated to sync the result back into Association.plan.
  const configurations = await stripe.billingPortal.configurations.list({ limit: 100 })
  const existingConfig = configurations.data.find(c => c.is_default)

  const configParams: Stripe.BillingPortal.ConfigurationCreateParams = {
    features: {
      ...(existingConfig?.features as Stripe.BillingPortal.ConfigurationCreateParams["features"]),
      // Stripe requires payment_method_update enabled as a prerequisite for
      // subscription_update — force it on rather than relying on whatever the existing
      // configuration (or a brand new one, which defaults everything off) already has.
      payment_method_update: { enabled: true },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: portalProducts,
      },
    },
  }

  if (existingConfig) {
    await stripe.billingPortal.configurations.update(existingConfig.id, {
      features: configParams.features,
    })
    console.log(`Updated default Billing Portal configuration (${existingConfig.id}) with subscription_update.`)
  } else {
    const created = await stripe.billingPortal.configurations.create(configParams)
    console.log(`Created Billing Portal configuration (${created.id}). Set it as default in the Stripe Dashboard (Settings → Billing → Customer portal) if it isn't already.`)
  }

  console.log("\nAdd these to .env.local / production env:\n")
  console.log(envLines.join("\n"))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

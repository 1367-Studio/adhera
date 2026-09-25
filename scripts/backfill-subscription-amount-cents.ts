// One-off backfill: Association.subscriptionAmountCents only gets set going forward, by the
// customer.subscription.created/updated webhook handler (src/app/api/webhook/stripe/route.ts)
// added alongside platformFeeRate() (src/lib/stripe.ts). Every association that was already
// ACTIVE before that change has a live stripeSubscriptionId but a null subscriptionAmountCents
// until its next Stripe event — this fills that gap once by reading the current price straight
// off Stripe, the same field the webhook itself reads (sub.items.data[0].price.unit_amount).
//
// Usage:
//   npx tsx scripts/backfill-subscription-amount-cents.ts          (dry run, prints a report)
//   npx tsx scripts/backfill-subscription-amount-cents.ts --apply  (writes Association.subscriptionAmountCents)
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import Stripe from "stripe"

dotenv.config({ path: ".env.local" })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })
const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-05-27.dahlia" as never })

const apply = process.argv.includes("--apply")

async function main() {
  const associations = await prisma.association.findMany({
    where:  { subscriptionStatus: "ACTIVE", stripeSubscriptionId: { not: null }, subscriptionAmountCents: null },
    select: { id: true, name: true, stripeSubscriptionId: true },
  })

  console.log(`${associations.length} ACTIVE association(s) with no subscriptionAmountCents yet.`)

  for (const assoc of associations) {
    let amountCents: number | null
    try {
      const sub = await stripe.subscriptions.retrieve(assoc.stripeSubscriptionId!)
      amountCents = sub.items.data[0]?.price.unit_amount ?? null
    } catch (err) {
      console.error(`  ${assoc.name} (${assoc.id}): failed to fetch ${assoc.stripeSubscriptionId} —`, err instanceof Error ? err.message : err)
      continue
    }

    const flag = amountCents === 0 ? "  <- FREE (will now pay the 1% platform fee)" : ""
    console.log(`  ${assoc.name} (${assoc.id}): ${amountCents ?? "null"}${flag}`)

    if (apply) {
      await prisma.association.update({ where: { id: assoc.id }, data: { subscriptionAmountCents: amountCents } })
    }
  }

  console.log(apply ? "Applied." : "Dry run — pass --apply to write.")
}

main().finally(() => prisma.$disconnect())

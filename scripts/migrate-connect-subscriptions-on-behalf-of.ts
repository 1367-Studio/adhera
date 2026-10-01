// One-off migration: sets on_behalf_of on every still-live Stripe Connect Subscription
// (DonationSubscription, CotisationSubscription, CotisationInstallmentPlan) created before
// the checkout routes started passing on_behalf_of themselves. Without this, those
// subscriptions keep billing forever under the old regime — Stripe's own processing fee
// (~1.5%+0.25€) deducted from Formwise's platform balance instead of the association's —
// since on_behalf_of is fixed at subscription-creation time and never changes on its own.
// Confirmed via `stripe docs api "POST /v1/subscriptions/{id}"` that on_behalf_of is a
// valid *update* parameter ("The account on behalf of which to charge, for each of the
// subscription's invoices") — it only affects future invoices, nothing already billed.
//
// Only touches on_behalf_of. Does not change amount, destination, application_fee_percent,
// or anything else already correct on these subscriptions.
//
// Usage:
//   npx tsx scripts/migrate-connect-subscriptions-on-behalf-of.ts            (dry run, prints a report)
//   npx tsx scripts/migrate-connect-subscriptions-on-behalf-of.ts --apply    (writes to Stripe)
//   npx tsx scripts/migrate-connect-subscriptions-on-behalf-of.ts --apply --yes-live  (required with a live key)
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import Stripe from "stripe"

dotenv.config({ path: ".env.local" })

const APPLY           = process.argv.includes("--apply")
const LIVE_CONFIRM_FLAG = "--yes-live"

const stripeKey = process.env.STRIPE_SECRET_KEY
if (!stripeKey) {
  console.error("STRIPE_SECRET_KEY is not set")
  process.exit(1)
}
if (APPLY && stripeKey.startsWith("sk_live_") && !process.argv.includes(LIVE_CONFIRM_FLAG)) {
  console.error(
    `STRIPE_SECRET_KEY is a LIVE key. Re-run with ${LIVE_CONFIRM_FLAG} once you've verified this in test mode first.`
  )
  process.exit(1)
}

const stripe  = new Stripe(stripeKey, { apiVersion: "2026-05-27.dahlia" as never, maxNetworkRetries: 2 })
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

type Target = {
  source:               "DonationSubscription" | "CotisationSubscription" | "CotisationInstallmentPlan"
  recordId:             string
  associationName:      string
  stripeSubscriptionId: string
  stripeConnectId:      string
}

async function collectTargets(): Promise<Target[]> {
  const [donationSubs, cotisationSubs, installmentPlans] = await Promise.all([
    prisma.donationSubscription.findMany({
      where:  { status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { id: true, stripeSubscriptionId: true, association: { select: { name: true, stripeConnectId: true } } },
    }),
    prisma.cotisationSubscription.findMany({
      where:  { status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { id: true, stripeSubscriptionId: true, association: { select: { name: true, stripeConnectId: true } } },
    }),
    prisma.cotisationInstallmentPlan.findMany({
      where:  { status: "ACTIVE" },
      select: { id: true, stripeSubscriptionId: true, association: { select: { name: true, stripeConnectId: true } } },
    }),
  ])

  const targets: Target[] = []
  for (const row of donationSubs)
    if (row.association.stripeConnectId)
      targets.push({ source: "DonationSubscription", recordId: row.id, associationName: row.association.name, stripeSubscriptionId: row.stripeSubscriptionId, stripeConnectId: row.association.stripeConnectId })
  for (const row of cotisationSubs)
    if (row.association.stripeConnectId)
      targets.push({ source: "CotisationSubscription", recordId: row.id, associationName: row.association.name, stripeSubscriptionId: row.stripeSubscriptionId, stripeConnectId: row.association.stripeConnectId })
  for (const row of installmentPlans)
    if (row.association.stripeConnectId)
      targets.push({ source: "CotisationInstallmentPlan", recordId: row.id, associationName: row.association.name, stripeSubscriptionId: row.stripeSubscriptionId, stripeConnectId: row.association.stripeConnectId })

  return targets
}

async function main() {
  const targets = await collectTargets()
  console.log(`${targets.length} live Connect subscription(s) found across all associations.\n`)

  let alreadySet = 0
  let updated    = 0
  let skippedNotLive = 0
  const errors: { target: Target; reason: string }[] = []

  // Sequential, not Promise.all — this hits Stripe's API once per subscription (a retrieve
  // plus, when APPLY, an update) and there's no need to race its rate limits for a one-off
  // migration run.
  for (const target of targets) {
    try {
      const subscription = await stripe.subscriptions.retrieve(target.stripeSubscriptionId)

      if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
        skippedNotLive++
        continue
      }
      if (subscription.on_behalf_of === target.stripeConnectId) {
        alreadySet++
        continue
      }

      if (APPLY) {
        await stripe.subscriptions.update(target.stripeSubscriptionId, { on_behalf_of: target.stripeConnectId })
      }
      updated++
      console.log(`${APPLY ? "Updated" : "Would update"}: ${target.source} ${target.recordId} — ${target.associationName} (${target.stripeSubscriptionId})`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      errors.push({ target, reason })
      console.error(`ERROR: ${target.source} ${target.recordId} — ${target.associationName} (${target.stripeSubscriptionId}): ${reason}`)
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run"} summary:`)
  console.log(`  ${updated} ${APPLY ? "updated" : "would be updated"}`)
  console.log(`  ${alreadySet} already had on_behalf_of set`)
  console.log(`  ${skippedNotLive} skipped (subscription no longer live on Stripe)`)
  console.log(`  ${errors.length} error(s)`)

  if (!APPLY && targets.length > 0)
    console.log("\nRe-run with --apply to write these changes to Stripe.")
}

main().catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })

// Read-only report: for every still-live Stripe Connect Subscription (DonationSubscription,
// CotisationSubscription, CotisationInstallmentPlan), checks whether on_behalf_of is already
// set to the association's Connect account — and, for the ones that aren't, pre-flights
// whether that association's Connect account currently looks able to accept it (charges
// enabled, no pending requirements) before we ever run the real migration.
//
// GET-only: stripe.subscriptions.retrieve and stripe.accounts.retrieve. Never calls
// stripe.subscriptions.update or writes to the database in any way. Companion script
// scripts/migrate-connect-subscriptions-on-behalf-of.ts is the one that actually writes,
// once this report looks clean.
//
// Usage (run this yourself — the agent cannot read .env.production.local):
//   npx tsx scripts/check-connect-subscriptions-on-behalf-of-status.ts
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import Stripe from "stripe"

dotenv.config({ path: ".env.production.local" })

const dbUrl = process.env.DATABASE_URL ?? ""
if (!dbUrl.includes("rycxfxzubzdqvkqtnmes")) throw new Error("not prod")

const stripeKey = process.env.STRIPE_SECRET_KEY
if (!stripeKey) {
  console.error("STRIPE_SECRET_KEY is not set")
  process.exit(1)
}
if (!stripeKey.startsWith("sk_live_")) {
  console.error("STRIPE_SECRET_KEY in .env.production.local is not a live key — refusing to run (this report is only meaningful against production Stripe data).")
  process.exit(1)
}

const stripe  = new Stripe(stripeKey, { apiVersion: "2026-05-27.dahlia" as never, maxNetworkRetries: 2 })
const adapter = new PrismaPg({ connectionString: dbUrl })
const prisma  = new PrismaClient({ adapter })

type Target = {
  source:               "DonationSubscription" | "CotisationSubscription" | "CotisationInstallmentPlan"
  recordId:             string
  associationId:        string
  associationName:      string
  stripeSubscriptionId: string
  stripeConnectId:      string
}

async function collectTargets(): Promise<Target[]> {
  const [donationSubs, cotisationSubs, installmentPlans] = await Promise.all([
    prisma.donationSubscription.findMany({
      where:  { status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { id: true, stripeSubscriptionId: true, association: { select: { id: true, name: true, stripeConnectId: true } } },
    }),
    prisma.cotisationSubscription.findMany({
      where:  { status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { id: true, stripeSubscriptionId: true, association: { select: { id: true, name: true, stripeConnectId: true } } },
    }),
    prisma.cotisationInstallmentPlan.findMany({
      where:  { status: "ACTIVE" },
      select: { id: true, stripeSubscriptionId: true, association: { select: { id: true, name: true, stripeConnectId: true } } },
    }),
  ])

  const targets: Target[] = []
  for (const row of donationSubs)
    if (row.association.stripeConnectId)
      targets.push({ source: "DonationSubscription", recordId: row.id, associationId: row.association.id, associationName: row.association.name, stripeSubscriptionId: row.stripeSubscriptionId, stripeConnectId: row.association.stripeConnectId })
  for (const row of cotisationSubs)
    if (row.association.stripeConnectId)
      targets.push({ source: "CotisationSubscription", recordId: row.id, associationId: row.association.id, associationName: row.association.name, stripeSubscriptionId: row.stripeSubscriptionId, stripeConnectId: row.association.stripeConnectId })
  for (const row of installmentPlans)
    if (row.association.stripeConnectId)
      targets.push({ source: "CotisationInstallmentPlan", recordId: row.id, associationId: row.association.id, associationName: row.association.name, stripeSubscriptionId: row.stripeSubscriptionId, stripeConnectId: row.association.stripeConnectId })

  return targets
}

async function main() {
  const targets = await collectTargets()
  console.log(`${targets.length} live Connect subscription(s) referenced in the database.\n`)

  const alreadySet: Target[]              = []
  const needsUpdate: Target[]              = []
  const staleInDb: Target[]                = []
  const retrieveErrors: { target: Target; reason: string }[] = []

  for (const target of targets) {
    try {
      const subscription = await stripe.subscriptions.retrieve(target.stripeSubscriptionId)
      if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
        staleInDb.push(target)
      } else if (subscription.on_behalf_of === target.stripeConnectId) {
        alreadySet.push(target)
      } else {
        needsUpdate.push(target)
      }
    } catch (err) {
      retrieveErrors.push({ target, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // Pre-flight: for every association that actually needs the update, check right now
  // whether its Connect account looks able to accept on_behalf_of — so we know before
  // running the real migration which ones are likely to error out, instead of finding out
  // mid-run. One retrieve per *association*, not per subscription (dedup — several
  // subscriptions can belong to the same association).
  const associationsNeedingUpdate = [...new Map(needsUpdate.map(t => [t.associationId, t])).values()]
  const accountIssues: { associationName: string; stripeConnectId: string; issue: string }[] = []
  for (const target of associationsNeedingUpdate) {
    try {
      const account = await stripe.accounts.retrieve(target.stripeConnectId)
      if (!account.charges_enabled) {
        accountIssues.push({ associationName: target.associationName, stripeConnectId: target.stripeConnectId, issue: "charges_enabled is false" })
      } else if (account.requirements?.disabled_reason) {
        accountIssues.push({ associationName: target.associationName, stripeConnectId: target.stripeConnectId, issue: `disabled_reason: ${account.requirements.disabled_reason}` })
      } else if ((account.requirements?.currently_due?.length ?? 0) > 0) {
        accountIssues.push({ associationName: target.associationName, stripeConnectId: target.stripeConnectId, issue: `currently_due: ${account.requirements!.currently_due!.join(", ")}` })
      }
    } catch (err) {
      accountIssues.push({ associationName: target.associationName, stripeConnectId: target.stripeConnectId, issue: `account retrieve failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  console.log("=== Summary ===")
  console.log(`  ${alreadySet.length} already have on_behalf_of set correctly (created after the code deploy — no action needed)`)
  console.log(`  ${needsUpdate.length} still need the migration (created before the deploy)`)
  console.log(`  ${staleInDb.length} are canceled/expired on Stripe but still marked live in the database (unrelated data drift, not this migration's concern)`)
  console.log(`  ${retrieveErrors.length} failed to retrieve from Stripe`)
  console.log(`  ${associationsNeedingUpdate.length} distinct association(s) among the ones needing the update`)
  console.log(`  ${accountIssues.length} of those association(s) show a Connect account issue that could make the real update fail`)

  if (needsUpdate.length > 0) {
    console.log("\n=== Subscriptions needing the update, by association ===")
    const bySource = { DonationSubscription: 0, CotisationSubscription: 0, CotisationInstallmentPlan: 0 }
    for (const t of needsUpdate) bySource[t.source]++
    console.log(`  DonationSubscription: ${bySource.DonationSubscription}`)
    console.log(`  CotisationSubscription: ${bySource.CotisationSubscription}`)
    console.log(`  CotisationInstallmentPlan: ${bySource.CotisationInstallmentPlan}`)
  }

  if (accountIssues.length > 0) {
    console.log("\n=== Connect accounts with a potential issue ===")
    for (const issue of accountIssues)
      console.log(`  ${issue.associationName} (${issue.stripeConnectId}): ${issue.issue}`)
  }

  if (staleInDb.length > 0) {
    console.log("\n=== Stale in DB (canceled/expired on Stripe, still ACTIVE/PAST_DUE locally) ===")
    for (const t of staleInDb)
      console.log(`  ${t.source} ${t.recordId} — ${t.associationName} (${t.stripeSubscriptionId})`)
  }

  if (retrieveErrors.length > 0) {
    console.log("\n=== Retrieve errors ===")
    for (const e of retrieveErrors)
      console.log(`  ${e.target.source} ${e.target.recordId} — ${e.target.associationName} (${e.target.stripeSubscriptionId}): ${e.reason}`)
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })

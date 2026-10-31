// One-off: sets Association.subscriptionGracePeriodEndsAt for Les Ailes de Louis so the
// new subscription-grace-period-sweep cron suspends access if she hasn't converted off
// the 0€ PricingOffer by the deadline. Also surfaces the new SubscriptionUpgradeModal in
// her dashboard from the moment this is run (see dashboard/layout.tsx's showSubscriptionUpgradeModal).
//
// NOT to be run against prod without explicit go-ahead — this directly affects a real
// client's billing enforcement. Defaults to dev/stage (whatever DATABASE_URL is active in
// .env.local); pass --prod to target production explicitly, which also requires
// .env.production.local to be present.
//
// Usage:
//   npx tsx scripts/set-les-ailes-subscription-grace-period.ts --deadline 2026-11-06T00:00:00Z [--prod] [--apply]
import * as dotenv from "dotenv"

const args     = process.argv.slice(2)
const isProd   = args.includes("--prod")
const apply    = args.includes("--apply")
const deadlineArg = args[args.indexOf("--deadline") + 1]

if (isProd) dotenv.config({ path: ".env.production.local", override: true })

const ASSOCIATION_ID = "cmtwo7tci000104l0g5lfe5mv" // Les Ailes de Louis

async function main() {
  if (!deadlineArg) throw new Error("Pass --deadline <ISO date>, e.g. --deadline 2026-11-06T00:00:00Z")
  const deadline = new Date(deadlineArg)
  if (Number.isNaN(deadline.getTime())) throw new Error(`Invalid --deadline: ${deadlineArg}`)

  const dbUrl = process.env.DATABASE_URL ?? ""
  if (isProd && !dbUrl.includes("rycxfxzubzdqvkqtnmes")) {
    throw new Error("--prod was passed but DATABASE_URL does not look like production — aborting.")
  }

  const { prisma } = await import("@/lib/prisma/client")

  const assoc = await prisma.association.findUnique({
    where:  { id: ASSOCIATION_ID },
    select: { name: true, subscriptionStatus: true, subscriptionAmountCents: true, subscriptionGracePeriodEndsAt: true },
  })
  if (!assoc) throw new Error(`Association ${ASSOCIATION_ID} not found on ${isProd ? "prod" : "dev/stage"}`)

  console.log(`Target: ${assoc.name} (${isProd ? "PROD" : "dev/stage"})`)
  console.log(`Current: status=${assoc.subscriptionStatus} amountCents=${assoc.subscriptionAmountCents} gracePeriodEndsAt=${assoc.subscriptionGracePeriodEndsAt?.toISOString() ?? "null"}`)
  console.log(`New deadline: ${deadline.toISOString()}`)

  // Re-running this against an association the sweep cron already suspended (status
  // SUSPENDED, still on the 0€ offer) only moves the deadline — it does NOT by itself let
  // her back in, since nothing else ever flips subscriptionStatus back once set. Staff
  // granting more time clearly means "let her back in under the new deadline", not "leave
  // her locked out until she pays AND the new deadline happens to also be in the future",
  // so restore access here too rather than leaving a second manual step undocumented.
  const willReactivate = assoc.subscriptionStatus === "SUSPENDED" && assoc.subscriptionAmountCents === 0
  if (willReactivate) {
    console.log("Association is currently SUSPENDED on the 0€ offer — this run will also restore access under the new deadline.")
  }

  if (!apply) {
    console.log("\nDry run — pass --apply to actually write this.")
    await prisma.$disconnect()
    return
  }

  await prisma.association.update({
    where: { id: ASSOCIATION_ID },
    data: {
      subscriptionGracePeriodEndsAt: deadline,
      ...(willReactivate ? { subscriptionStatus: "ACTIVE" as const, suspendedAt: null } : {}),
    },
  })
  console.log("Done.")
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })

// One-off migration: tags every existing Association with an AssociationPlan (ESSENTIAL
// or PRO) based on its current active member count, for the member-limit/IA-gating logic
// in src/lib/plan-limits.ts and src/lib/modules.ts. This never touches Stripe or
// stripeSubscriptionId — associations keep billing on whatever Price they're already on
// (see src/lib/stripe.ts's legacy STRIPE_PRICE_MONTHLY/YEARLY comment). A tier switch that
// actually changes what someone pays only ever happens if the association's own admin
// chooses to upgrade/downgrade via the Stripe Customer Portal.
//
// Usage:
//   npx tsx scripts/migrate-existing-associations-to-tier.ts          (dry run, prints a report)
//   npx tsx scripts/migrate-existing-associations-to-tier.ts --apply  (writes Association.plan)
import * as dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

dotenv.config({ path: ".env.local" })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

const ESSENTIAL_LIMIT = 150
const PRO_LIMIT       = 600

const APPLY = process.argv.includes("--apply")

async function main() {
  const associations = await prisma.association.findMany({
    where:  { deletedAt: null },
    select: {
      id: true, name: true, plan: true,
      _count: { select: { membres: { where: { status: "ACTIF" } } } },
    },
    orderBy: { name: "asc" },
  })

  const needsReview: { name: string; count: number }[] = []
  const changes: { id: string; name: string; from: string; to: "ESSENTIAL" | "PRO"; count: number }[] = []

  for (const assoc of associations) {
    const count = assoc._count.membres
    const target: "ESSENTIAL" | "PRO" = count <= ESSENTIAL_LIMIT ? "ESSENTIAL" : "PRO"

    if (count > PRO_LIMIT) {
      needsReview.push({ name: assoc.name, count })
    }
    if (assoc.plan !== target) {
      changes.push({ id: assoc.id, name: assoc.name, from: assoc.plan, to: target, count })
    }
  }

  console.log(`${associations.length} association(s) evaluated.\n`)

  if (changes.length === 0) {
    console.log("Nothing to change — every association already has the right plan tag.")
  } else {
    console.log(`${changes.length} association(s) to ${APPLY ? "update" : "would update"}:\n`)
    for (const c of changes) {
      console.log(`  ${c.name} — ${c.from} → ${c.to} (${c.count} active members)`)
    }
  }

  if (needsReview.length > 0) {
    console.log(`\n⚠ ${needsReview.length} association(s) exceed the Pro limit (${PRO_LIMIT}) and are tagged PRO by default — review manually for a "sur mesure" arrangement:\n`)
    for (const r of needsReview) {
      console.log(`  ${r.name} — ${r.count} active members`)
    }
  }

  if (!APPLY) {
    console.log("\nDry run only — no rows written. Re-run with --apply to write these changes.")
    return
  }

  for (const c of changes) {
    await prisma.association.update({ where: { id: c.id }, data: { plan: c.to } })
  }
  console.log(`\nApplied ${changes.length} update(s).`)
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

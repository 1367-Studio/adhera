// Part of the "default finance categories" correction task (round 2): the default catalog's
// "fraisStripe" category now points at 627000 (same account as "fraisBancaires"), reversing the
// 627800 split added by PR #423 a few days earlier. That rename is template-only — it never
// touches existing FinanceCategory rows (see default-categories.ts's doc comment) — so any
// association whose "fraisStripe" category was already created under the old 627800 code just
// keeps it. This lists those rows for optional manual follow-up; never writes anything.
//
// Usage:
//   npx tsx scripts/review-frais-stripe-account-merge.ts
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.production.local" })

async function main() {
  const { prisma } = await import("@/lib/prisma/client")

  const rows = await prisma.financeCategory.findMany({
    where:  { key: "fraisStripe", accountingCode: "627800" },
    select: { id: true, associationId: true, archivedAt: true, _count: { select: { expenses: true } } },
    orderBy: { associationId: "asc" },
  })

  if (rows.length === 0) {
    console.log(`No "fraisStripe" category still on 627800 — nothing to review.`)
    return
  }

  console.log(`${rows.length} "fraisStripe" FinanceCategory row(s) still on the old 627800 account:`)
  for (const row of rows) {
    console.log(`  ${row.associationId}${row.archivedAt ? " (archived)" : ""} — ${row._count.expenses} linked expense(s) (category id ${row.id})`)
  }
  console.log(`\nNever auto-repointed — if you want these to match the new default (627000), update accountingCode by hand per association (Comptabilité > Catégories UI, or a direct update), after confirming it won't collide with that association's own "fraisBancaires" category (also on 627000 — both are allowed to share it, see finance-category-form.tsx's non-blocking duplicate-code warning).`)

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

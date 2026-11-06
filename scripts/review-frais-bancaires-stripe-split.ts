// Part of the "default finance categories" correction task. Before this fix, connect-stripe-fee.ts
// booked Stripe's own per-charge processing fee under the "fraisBancaires" default category
// (see that file's bookConnectFeeExpense) — the same category a treasurer might also use for
// genuine bank charges (wire fees, account maintenance). Going forward, new Stripe-fee
// bookings land under the new "fraisStripe" category instead (see that file's current code),
// but EXISTING historical rows are still sitting under "fraisBancaires" and are never moved
// automatically — this is a report only, listing candidates for a human to re-point by hand.
//
// Two confidence tiers, both never auto-moved:
//   - high: the Expense's `reference` matches a STRIPE_FEE_EXPENSE_BOOKED ActivityLog row's
//     metadata.reference (see bookConnectFeeExpense) — a system-written link, not free text a
//     treasurer could have coincidentally typed, so this is as close to certain as this data
//     gets.
//   - low: only the exact description "Frais Stripe" (FEE_EXPENSE_DESCRIPTIONS.stripeFee)
//     matches, with no corresponding ActivityLog row — still a strong signal (that literal
//     string is only ever system-written), but the log may predate this script or have been
//     pruned, so it's surfaced as a separate, lower-confidence bucket rather than silently
//     merged into the first.
//
// Usage:
//   npx tsx scripts/review-frais-bancaires-stripe-split.ts
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.production.local" })

const STRIPE_FEE_DESCRIPTION = "Frais Stripe"

async function main() {
  const { prisma } = await import("@/lib/prisma/client")

  const fraisBancairesCategories = await prisma.financeCategory.findMany({
    where:  { key: "fraisBancaires" },
    select: { id: true, associationId: true, archivedAt: true },
  })

  if (fraisBancairesCategories.length === 0) {
    console.log(`No "fraisBancaires" FinanceCategory rows found.`)
    return
  }

  let totalHigh = 0
  let totalLow  = 0
  let totalOther = 0

  for (const category of fraisBancairesCategories) {
    const expenses = await prisma.expense.findMany({
      where:  { categoryId: category.id },
      select: { id: true, amount: true, date: true, description: true, reference: true },
      orderBy: { date: "asc" },
    })
    if (expenses.length === 0) continue

    const bookedLogs = await prisma.activityLog.findMany({
      where:  { associationId: category.associationId, action: "STRIPE_FEE_EXPENSE_BOOKED" },
      select: { metadata: true },
    })
    const bookedReferences = new Set(
      bookedLogs
        .map(l => (l.metadata as { reference?: string } | null)?.reference)
        .filter((r): r is string => Boolean(r))
    )

    const highConfidence = expenses.filter(e => e.reference && bookedReferences.has(e.reference))
    const lowConfidence  = expenses.filter(e => !highConfidence.includes(e) && e.description === STRIPE_FEE_DESCRIPTION)
    const other          = expenses.filter(e => !highConfidence.includes(e) && !lowConfidence.includes(e))
    totalHigh  += highConfidence.length
    totalLow   += lowConfidence.length
    totalOther += other.length

    if (highConfidence.length === 0 && lowConfidence.length === 0) continue

    console.log(`\nAssociation ${category.associationId}${category.archivedAt ? " (category archived)" : ""} — ${expenses.length} total expense(s) under "fraisBancaires":`)
    if (highConfidence.length > 0) {
      console.log(`  High confidence (${highConfidence.length}, linked by ActivityLog) — move to "fraisStripe":`)
      for (const e of highConfidence) console.log(`    ${e.date.toISOString().slice(0, 10)}  ${e.amount.toFixed(2)}€  ref=${e.reference}  (expense id ${e.id})`)
    }
    if (lowConfidence.length > 0) {
      console.log(`  Lower confidence (${lowConfidence.length}, description-only match, no ActivityLog found) — verify before moving:`)
      for (const e of lowConfidence) console.log(`    ${e.date.toISOString().slice(0, 10)}  ${e.amount.toFixed(2)}€  ref=${e.reference ?? "—"}  (expense id ${e.id})`)
    }
  }

  console.log(`\nTotal: ${totalHigh} high-confidence + ${totalLow} lower-confidence candidate(s) across ${fraisBancairesCategories.length} association(s) look like Stripe fees mis-booked under "fraisBancaires" (vs ${totalOther} that look like genuine bank fees and should stay). This script never moves anything — re-point each candidate's categoryId to that association's "fraisStripe" category by hand (or via the Comptabilité > Catégories UI) after confirming it's really a Stripe fee.`)

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

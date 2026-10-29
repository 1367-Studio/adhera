// Part of the "padronizar categorias contábeis" task: accountingCode is becoming mandatory
// and restricted to the controlled reference list (src/lib/finance/chart-of-accounts.ts). This
// backfills every existing FinanceCategory (any association) that currently has a null/empty
// accountingCode, so the DB can later get a NOT NULL constraint — see the migration note on
// FinanceCategory.accountingCode in prisma/schema.prisma.
//
// Only categories with a recognized stable `key` (one of DEFAULT_FINANCE_CATEGORIES's keys, or
// the retired "materiel" key — see default-categories.ts's doc comment on why it was split)
// are fixed automatically, unambiguously, from that list. A custom category (key = null) has
// no reliable signal to guess an account from — free-text name matching against the reference
// list would risk silently assigning the WRONG account on a real association's books, which is
// worse than leaving it for a human. Those are only ever listed for manual review, never
// auto-assigned.
//
// Usage:
//   npx tsx scripts/backfill-finance-category-accounting-codes.ts            (dry run, default)
//   npx tsx scripts/backfill-finance-category-accounting-codes.ts --execute  (writes it)
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.production.local" })

const execute = process.argv.includes("--execute")

// The old generic "Matériel / Fournitures" default (606000) was split into 5 more specific
// categories in this task (see default-categories.ts) — a production row still carrying the
// old key has no 1:1 successor, so it's remapped to the closest general-purpose one
// ("fournituresAdmin", 6064) rather than left unresolved. A treasurer can move it to a more
// specific one (materielEntretien, achatsMarchandises, servicesExterieurs...) by hand later if
// it actually belongs there.
const RETIRED_KEY_REMAP: Record<string, string> = {
  materiel: "fournituresAdmin",
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (!dbUrl.includes("rycxfxzubzdqvkqtnmes") && !execute) {
    console.warn("DATABASE_URL does not look like production — running against whatever this env points to.")
  }

  const { prisma } = await import("@/lib/prisma/client")
  const { defaultCategoryByKey } = await import("@/lib/finance/default-categories")

  const rows = await prisma.financeCategory.findMany({
    where:  { OR: [{ accountingCode: null }, { accountingCode: "" }] },
    select: { id: true, associationId: true, name: true, type: true, key: true, isDefault: true, archivedAt: true },
    orderBy: [{ associationId: "asc" }, { name: "asc" }],
  })

  console.log(`Found ${rows.length} FinanceCategory row(s) with no accountingCode.\n`)

  const autoFixable: { id: string; code: string; label: string }[] = []
  const legacyNoKeyDefault: typeof rows = []
  const needsReview: typeof rows = []

  for (const row of rows) {
    const resolvedKey = row.key ? (RETIRED_KEY_REMAP[row.key] ?? row.key) : null
    const def = resolvedKey ? defaultCategoryByKey(resolvedKey) : undefined
    if (def && def.type === row.type) {
      autoFixable.push({ id: row.id, code: def.accountingCode, label: `${row.associationId} — "${row.name}" (key=${row.key}) -> ${def.accountingCode}` })
    } else if (row.isDefault && !row.key) {
      // Pre-Fase-1 seed rows ("Ventes", "Paiements Stripe"...) that predate the stable `key`
      // concept entirely — not part of DEFAULT_FINANCE_CATEGORIES's structured set, so there's
      // no successor to auto-map to, but also not a real custom category a treasurer
      // deliberately created. Called out separately so a human reviewing the list doesn't have
      // to re-derive "this one's just old scaffolding" for every row in that bucket — these are
      // candidates to archive outright rather than assign a real account to.
      legacyNoKeyDefault.push(row)
    } else {
      needsReview.push(row)
    }
  }

  console.log(`Auto-fixable from a recognized key: ${autoFixable.length}`)
  for (const f of autoFixable) console.log(`  ${f.label}`)

  console.log(`\nLegacy pre-Fase-1 default rows (isDefault, no key) — consider archiving instead of assigning a code: ${legacyNoKeyDefault.length}`)
  for (const r of legacyNoKeyDefault) console.log(`  ${r.associationId} — "${r.name}" (${r.type}${r.archivedAt ? ", already archived" : ""})`)

  console.log(`\nNeeds manual review — real custom categories, no reliable signal to auto-assign: ${needsReview.length}`)
  for (const r of needsReview) console.log(`  ${r.associationId} — "${r.name}" (${r.type}, key=${r.key ?? "null"}, isDefault=${r.isDefault})`)

  if (!execute) {
    console.log(`\nDry run — would set accountingCode on ${autoFixable.length} row(s). Re-run with --execute to write. The ${legacyNoKeyDefault.length + needsReview.length} row(s) above always require a manual decision, with or without --execute.`)
    return
  }

  for (const fix of autoFixable) {
    await prisma.financeCategory.update({ where: { id: fix.id }, data: { accountingCode: fix.code } })
  }
  console.log(`\nUpdated ${autoFixable.length} row(s).`)

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

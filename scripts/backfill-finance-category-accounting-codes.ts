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

// Known-wrong codes already SET on a row (as opposed to the null/empty rows the main pass
// below handles) — a real bug found while standardizing the default catalog:
// "commissionFormwise" used to point at 6226/622600 (Honoraires) instead of 622200
// (Commissions et courtages sur ventes). Same-key, unambiguous 1:1 correction, so it's safe to
// auto-fix rather than leave for manual review.
const KNOWN_WRONG_CODE_FIXES: { key: string; from: string; to: string }[] = [
  { key: "commissionFormwise", from: "6226",   to: "622200" },
  { key: "commissionFormwise", from: "622600", to: "622200" },
]

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

  console.log(`\n--- Known-wrong-code corrections (rows that already HAVE a code, just the wrong one) ---`)
  let wrongCodeTotal = 0
  for (const wrong of KNOWN_WRONG_CODE_FIXES) {
    const wrongRows = await prisma.financeCategory.findMany({
      where:  { key: wrong.key, accountingCode: wrong.from },
      select: { id: true, associationId: true, name: true },
    })
    if (wrongRows.length === 0) continue
    wrongCodeTotal += wrongRows.length
    console.log(`key="${wrong.key}" ${wrong.from} -> ${wrong.to}: ${wrongRows.length} row(s)`)
    for (const row of wrongRows) console.log(`  ${row.associationId} — "${row.name}"`)
    if (execute) {
      await prisma.financeCategory.updateMany({ where: { id: { in: wrongRows.map(r => r.id) } }, data: { accountingCode: wrong.to } })
    }
  }

  if (!execute) {
    console.log(`\nDry run — would set accountingCode on ${autoFixable.length} row(s) and correct ${wrongCodeTotal} known-wrong-code row(s). Re-run with --execute to write. The ${legacyNoKeyDefault.length + needsReview.length} row(s) above always require a manual decision, with or without --execute.`)
    return
  }

  for (const fix of autoFixable) {
    await prisma.financeCategory.update({ where: { id: fix.id }, data: { accountingCode: fix.code } })
  }
  console.log(`\nUpdated ${autoFixable.length} row(s); corrected ${wrongCodeTotal} known-wrong-code row(s).`)

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

// Part of the "default finance categories" correction task (round 2). DEFAULT_FINANCE_CATEGORIES'
// `name`/`description` text is template-only — renaming an entry there never touches an
// existing FinanceCategory row (see that file's own doc comment), so every association that
// already created one of the corrected categories (e.g. "Achats pour revente") is still
// showing the OLD text until someone edits it by hand. This backfills that text onto every
// already-created DEFAULT category row (isDefault: true, matched by its stable `key`), so the
// catalog correction actually reaches associations that onboarded before it, not just new ones.
//
// Deliberately only ever touches `name`/`description` — purely cosmetic, never moves money,
// never reassigns a category's accountingCode (the one more sensitive rename — fraisStripe's
// 627800 -> 627000 merge — stays dry-run-review-only, see scripts/review-frais-stripe-account-merge.ts),
// never touches an Income/Expense row, and never archived rows (hidden already, lower stakes).
// A key no longer in DEFAULT_FINANCE_CATEGORIES (equipement, depreciationAmortization — removed
// from the current-use list, not renamed) has no `def` to match against and is left untouched.
//
// Usage:
//   npx tsx scripts/backfill-default-category-text.ts            (dry run, default)
//   npx tsx scripts/backfill-default-category-text.ts --execute  (writes it)
import * as dotenv from "dotenv"
dotenv.config({ path: process.argv.includes("--prod") ? ".env.production.local" : ".env.local" })
import { Prisma } from "@prisma/client"

const execute = process.argv.includes("--execute")

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (process.argv.includes("--prod") && !dbUrl.includes("rycxfxzubzdqvkqtnmes") && execute) {
    throw new Error("--prod --execute but DATABASE_URL doesn't look like production — aborting.")
  }

  const { prisma } = await import("@/lib/prisma/client")
  const { DEFAULT_FINANCE_CATEGORIES } = await import("@/lib/finance/default-categories")

  const byKey = new Map(DEFAULT_FINANCE_CATEGORIES.map(c => [c.key, c]))

  const rows = await prisma.financeCategory.findMany({
    where:  { isDefault: true, key: { not: null }, archivedAt: null },
    select: { id: true, associationId: true, key: true, name: true, description: true },
    orderBy: [{ associationId: "asc" }, { key: "asc" }],
  })

  const toUpdate: { id: string; associationId: string; fromName: string; toName: string; fromDescription: string | null; toDescription: string }[] = []
  for (const row of rows) {
    const def = row.key ? byKey.get(row.key) : undefined
    if (!def) continue // Retired key (equipement/depreciationAmortization) — not renamed, left as-is.
    if (row.name === def.name && (row.description ?? "") === def.description) continue
    toUpdate.push({
      id: row.id, associationId: row.associationId,
      fromName: row.name, toName: def.name,
      fromDescription: row.description, toDescription: def.description,
    })
  }

  console.log(`Scanned ${rows.length} active default category row(s). ${toUpdate.length} need a name/description text sync:`)
  for (const u of toUpdate) {
    console.log(`  ${u.associationId} — "${u.fromName}" -> "${u.toName}"${u.fromName !== u.toName ? "" : " (description only)"}`)
  }

  if (!execute) {
    console.log(`\nDry run — re-run with --execute (and --prod to target production) to write. accountingCode is never touched here.`)
    return
  }

  // Renaming a default category's name can collide with the (associationId, type, lower(name))
  // WHERE archivedAt IS NULL unique constraint — that association already has a DIFFERENT
  // active category (default or custom) sitting on the exact target name (e.g. a treasurer
  // already hand-renamed one, or a legacy duplicate). A real but rare case this script can't
  // resolve on its own (which of the two should actually keep that name isn't something text
  // alone can decide) — skip it and report it for manual review rather than aborting every
  // OTHER association's otherwise-safe update.
  let updated = 0
  const skippedCollisions: typeof toUpdate = []
  for (const u of toUpdate) {
    try {
      await prisma.financeCategory.update({ where: { id: u.id }, data: { name: u.toName, description: u.toDescription } })
      updated++
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skippedCollisions.push(u)
        continue
      }
      throw error
    }
  }
  console.log(`\nUpdated ${updated} row(s).`)
  if (skippedCollisions.length > 0) {
    console.log(`\nSkipped ${skippedCollisions.length} row(s) — renaming would collide with another active category already on that name (needs manual review):`)
    for (const u of skippedCollisions) console.log(`  ${u.associationId} — "${u.fromName}" -> "${u.toName}"`)
  }

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

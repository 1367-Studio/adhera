// Part of the "default finance categories" correction task: accountingCode is moving from
// mixed-length PCG spellings ("706", "6278", "75411"...) to the canonical 6-digit form
// ("706000", "627800", "754110") — see normalizeAccountingCode in chart-of-accounts.ts. This
// pads every stored FinanceCategory.accountingCode to that form.
//
// Padding is always safe on its own (it never changes which real account a code points at),
// EXCEPT when an association already has two categories whose raw codes are different but
// would normalize to the SAME 6-digit code (e.g. one category stored "706" and another stored
// "706000" — both become "706000"). That's a real ambiguity this script never resolves on its
// own: which of the two should actually survive on that account depends on which category's
// real-world use is correct, not something this script can guess. Those pairs are only ever
// listed for manual review.
//
// Archived categories are included in the collision check (though NEVER written to — padding
// only ever touches active rows) specifically because an archived row's `key` is freed on
// archive (see FinanceCategory.key's doc comment in schema.prisma): it can be reactivated later
// under its original code, at which point a collision with an already-padded active row would
// surface with no warning. Flagging it now, while it's still only "latent," gives a human the
// chance to resolve it before that reactivation ever happens.
//
// Usage:
//   npx tsx scripts/normalize-finance-category-codes.ts            (dry run, default)
//   npx tsx scripts/normalize-finance-category-codes.ts --execute  (writes the safe ones)
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.production.local" })

const execute = process.argv.includes("--execute")

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (!dbUrl.includes("rycxfxzubzdqvkqtnmes") && !execute) {
    console.warn("DATABASE_URL does not look like production — running against whatever this env points to.")
  }

  const { prisma } = await import("@/lib/prisma/client")
  const { normalizeAccountingCode } = await import("@/lib/finance/chart-of-accounts")

  const rows = await prisma.financeCategory.findMany({
    where:  { accountingCode: { not: null } },
    select: { id: true, associationId: true, name: true, type: true, accountingCode: true, archivedAt: true },
    orderBy: [{ associationId: "asc" }, { type: "asc" }, { name: "asc" }],
  })
  const activeRows = rows.filter(r => !r.archivedAt)

  // Group by (associationId, type) — codes only collide within the same ledger side. Archived
  // rows are included here (never in what gets padded below) purely so a collision against them
  // is caught too — see the doc comment above.
  const byGroup = new Map<string, typeof rows>()
  for (const row of rows) {
    const groupKey = `${row.associationId}:${row.type}`
    byGroup.set(groupKey, [...(byGroup.get(groupKey) ?? []), row])
  }

  const safeToPad: { id: string; from: string; to: string; label: string }[] = []
  const liveCollisions:   { associationId: string; type: string; code: string; members: string[] }[] = []
  const latentCollisions: { associationId: string; type: string; code: string; members: string[] }[] = []

  for (const members of byGroup.values()) {
    const normalizedCount = new Map<string, typeof rows>()
    for (const row of members) {
      const normalized = normalizeAccountingCode(row.accountingCode!)
      normalizedCount.set(normalized, [...(normalizedCount.get(normalized) ?? []), row])
    }
    for (const [normalized, group] of normalizedCount) {
      const rawCodes = new Set(group.map(r => r.accountingCode))
      if (rawCodes.size === 1) {
        // Every member already shares the identical raw code — not a collision this script
        // caused or should touch. Pad it if it's the lone active row and still needs padding.
        if (group.length === 1 && !group[0].archivedAt && group[0].accountingCode !== normalized) {
          const row = group[0]
          safeToPad.push({ id: row.id, from: row.accountingCode!, to: normalized, label: `${row.associationId} — "${row.name}" (${row.type}) ${row.accountingCode} -> ${normalized}` })
        }
        continue
      }
      // Raw codes genuinely differ but normalize to the same value — a real ambiguity. "Live" if
      // 2+ ACTIVE rows collide today; "latent" if only reachable once an archived member of the
      // group is reactivated under its original key — see the doc comment above.
      const activeMembers = group.filter(r => !r.archivedAt)
      const bucket = activeMembers.length >= 2 ? liveCollisions : latentCollisions
      bucket.push({
        associationId: group[0].associationId, type: group[0].type, code: normalized,
        members: group.map(r => `"${r.name}" (raw: ${r.accountingCode}${r.archivedAt ? ", archived" : ""})`),
      })
      // A singleton active member in a latent collision is still safe to pad today — the
      // conflict only materializes if/when the archived sibling comes back.
      if (activeMembers.length === 1 && activeMembers[0].accountingCode !== normalized) {
        const row = activeMembers[0]
        safeToPad.push({ id: row.id, from: row.accountingCode!, to: normalized, label: `${row.associationId} — "${row.name}" (${row.type}) ${row.accountingCode} -> ${normalized}` })
      }
    }
  }

  console.log(`Scanned ${rows.length} FinanceCategory row(s) (${activeRows.length} active, ${rows.length - activeRows.length} archived).\n`)
  console.log(`Safe to pad (unambiguous, no live or latent collision): ${safeToPad.length}`)
  for (const f of safeToPad) console.log(`  ${f.label}`)

  console.log(`\nLive collisions — 2+ ACTIVE categories would land on the same code today: ${liveCollisions.length}`)
  for (const c of liveCollisions) console.log(`  ${c.associationId} (${c.type}) -> ${c.code}: ${c.members.join(", ")}`)

  console.log(`\nLatent collisions — safe to pad now, but an archived category here would collide if reactivated: ${latentCollisions.length}`)
  for (const c of latentCollisions) console.log(`  ${c.associationId} (${c.type}) -> ${c.code}: ${c.members.join(", ")}`)

  if (!execute) {
    console.log(`\nDry run — would pad ${safeToPad.length} row(s). Re-run with --execute to write. The ${liveCollisions.length} live + ${latentCollisions.length} latent collision(s) above always require a manual decision, with or without --execute.`)
    return
  }

  for (const fix of safeToPad) {
    await prisma.financeCategory.update({ where: { id: fix.id }, data: { accountingCode: fix.to } })
  }
  console.log(`\nUpdated ${safeToPad.length} row(s).`)

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

// Part of the "padronizar categorias contábeis" task: unifies real FinanceCategory duplicates
// — two rows for the SAME association with either the same stable `key` (a race predating the
// new @@unique([associationId, key]) constraint) or the same `type` + name (case-insensitive).
//
// Deliberately NEVER merges on accountingCode alone: two categories can legitimately share one
// account for different activities (e.g. Billetterie and Ateliers both on 706) — see the
// task's own example. Only an identical key or an identical name is treated as a real
// duplicate.
//
// For each duplicate group: keeps the default category (or, if several, the oldest) as the
// survivor, re-points every Income/Expense/BudgetLine/BoutiqueProduit/BoutiqueCommandeItem/
// Material at it, and deletes the others. A BudgetLine that would collide with one the
// survivor already has for the same (exerciceId, projectId) has its amount folded into the
// survivor's instead of being reassigned (the unique index forbids two rows there — see
// BudgetLine's doc comment in schema.prisma).
//
// Usage:
//   npx tsx scripts/merge-duplicate-finance-categories.ts            (dry run, default)
//   npx tsx scripts/merge-duplicate-finance-categories.ts --execute  (writes it)
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.production.local" })

const execute = process.argv.includes("--execute")

type CategoryRow = {
  id: string; associationId: string; name: string; type: "INCOME" | "EXPENSE"
  key: string | null; isDefault: boolean; createdAt: Date
}

function pickSurvivor(group: CategoryRow[]): CategoryRow {
  const sorted = [...group].sort((a, b) => {
    // A row WITH a stable key always wins, even over an older isDefault row without one —
    // getOrCreateDefaultCategory/resolveIncomeCategory look a default category up BY key, so
    // merging a keyed row into a keyless survivor would leave nothing for that key to resolve
    // to, and the next payment would just recreate a fresh "duplicate" under that same key
    // (confirmed against real dev data: every one of this association's 7 duplicate pairs was
    // an old pre-Fase-1 seed row with key=null next to a correctly-keyed one — naive
    // isDefault-then-oldest picked the keyless legacy row every single time).
    if ((a.key !== null) !== (b.key !== null)) return a.key !== null ? -1 : 1
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  return sorted[0]
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? ""
  if (!dbUrl.includes("rycxfxzubzdqvkqtnmes") && !execute) {
    console.warn("DATABASE_URL does not look like production — running against whatever this env points to.")
  }

  const { prisma } = await import("@/lib/prisma/client")

  const all = await prisma.financeCategory.findMany({
    select: { id: true, associationId: true, name: true, type: true, key: true, isDefault: true, createdAt: true, archivedAt: true },
    orderBy: { createdAt: "asc" },
  })

  const groups = new Map<string, CategoryRow[]>()
  for (const row of all) {
    if (row.archivedAt) continue // an archived category never merges — its history stays put
    if (row.key) {
      const groupKey = `key:${row.associationId}:${row.key}`
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), row])
    }
    const nameGroupKey = `name:${row.associationId}:${row.type}:${row.name.trim().toLowerCase()}`
    groups.set(nameGroupKey, [...(groups.get(nameGroupKey) ?? []), row])
  }

  // A row can land in both a key-group and a name-group — de-dup groups that ended up with the
  // exact same member set so it's only merged once.
  const seenMemberSets = new Set<string>()
  const duplicateGroups: CategoryRow[][] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const signature = group.map(r => r.id).sort().join(",")
    if (seenMemberSets.has(signature)) continue
    seenMemberSets.add(signature)
    duplicateGroups.push(group)
  }

  console.log(`Found ${duplicateGroups.length} duplicate group(s) across ${all.length} total categories.\n`)

  for (const group of duplicateGroups) {
    const survivor = pickSurvivor(group)
    const losers    = group.filter(r => r.id !== survivor.id)
    console.log(`Association ${survivor.associationId} — "${survivor.name}" (${survivor.type})`)
    console.log(`  survivor: ${survivor.id} (isDefault=${survivor.isDefault}, key=${survivor.key ?? "null"}, createdAt=${survivor.createdAt.toISOString()})`)
    for (const loser of losers) console.log(`  merging:  ${loser.id} (isDefault=${loser.isDefault}, key=${loser.key ?? "null"}, createdAt=${loser.createdAt.toISOString()})`)
  }

  if (!execute) {
    console.log(`\nDry run — would merge ${duplicateGroups.length} group(s). Re-run with --execute to write.`)
    return
  }

  for (const group of duplicateGroups) {
    const survivor = pickSurvivor(group)
    const loserIds = group.filter(r => r.id !== survivor.id).map(r => r.id)
    if (loserIds.length === 0) continue

    await prisma.$transaction(async (tx) => {
      await tx.income.updateMany({ where: { categoryId: { in: loserIds } }, data: { categoryId: survivor.id } })
      await tx.expense.updateMany({ where: { categoryId: { in: loserIds } }, data: { categoryId: survivor.id } })
      await tx.boutiqueProduit.updateMany({ where: { categoryId: { in: loserIds } }, data: { categoryId: survivor.id } })
      await tx.boutiqueCommandeItem.updateMany({ where: { categoryId: { in: loserIds } }, data: { categoryId: survivor.id } })
      await tx.material.updateMany({ where: { categoryId: { in: loserIds } }, data: { categoryId: survivor.id } })

      // BudgetLine needs per-row handling: the (exerciceId, categoryId, projectId) unique
      // index forbids two rows for the survivor's own (exerciceId, projectId) pair, so a
      // colliding loser row gets folded into the survivor's amount instead of reassigned.
      const loserLines = await tx.budgetLine.findMany({ where: { categoryId: { in: loserIds } } })
      for (const line of loserLines) {
        const existing = await tx.budgetLine.findFirst({
          where: { categoryId: survivor.id, exerciceId: line.exerciceId, projectId: line.projectId },
        })
        if (existing) {
          await tx.budgetLine.update({ where: { id: existing.id }, data: { amount: { increment: line.amount } } })
          await tx.budgetLine.delete({ where: { id: line.id } })
        } else {
          await tx.budgetLine.update({ where: { id: line.id }, data: { categoryId: survivor.id } })
        }
      }

      await tx.financeCategory.deleteMany({ where: { id: { in: loserIds } } })
    })
    console.log(`Merged ${loserIds.length} duplicate(s) into ${survivor.id} ("${survivor.name}").`)
  }

  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })

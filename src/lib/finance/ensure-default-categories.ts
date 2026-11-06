// Server-only — kept out of default-categories.ts specifically because this file imports
// `prisma`, which pulls in the `pg` driver (needs Node's `dns` module and breaks any client
// component that transitively imports it). default-categories.ts itself stays pure data so it
// can be imported directly from client components too (e.g. category-template-picker.tsx).
import { prisma } from "@/lib/prisma/client"
import { DEFAULT_FINANCE_CATEGORIES } from "@/lib/finance/default-categories"

// Find-or-create, keyed on `key` — never touches a category the association already has (see
// the seed route's own reasoning). Shared by the manual "Initialiser les catégories par
// défaut" button (api/finances/categories/seed) and the Compte de résultat report itself: the
// report's own calculation already tolerates a missing default category via a virtual line
// (defaultCategoryByKey as metadata-only fallback), but the "à catégoriser" → categorize
// action needs a REAL FinanceCategory row with a real id to assign — a virtual line has no id
// to PATCH onto a transaction. Calling this before computing the report guarantees that picker
// is never empty just because a treasurer never visited Comptabilité > Catégories first.
export async function ensureDefaultFinanceCategories(associationId: string): Promise<number> {
  // archivedAt: null — an archived default category has its key freed by DELETE precisely so
  // it drops out of this check and a fresh active row gets created under the same key/name
  // (see that route's doc comment). Without this filter, an archived default would count as
  // "already has one", and ensureDefaultFinanceCategories/the report's "à catégoriser" picker
  // would never offer a real, active row for that bucket again.
  const existing = await prisma.financeCategory.findMany({
    where:  { associationId, key: { not: null }, archivedAt: null },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map(c => c.key))

  const toCreate = DEFAULT_FINANCE_CATEGORIES.filter(c => !existingKeys.has(c.key))
  if (toCreate.length > 0) {
    await prisma.financeCategory.createMany({
      // skipDuplicates — an association can have a legacy, pre-Fase-1 category that already
      // owns the exact name a new default also wants (confirmed against real dev data: a
      // keyless "Salaires" already existed next to the new keyed "Salaires" default this adds).
      // Without this, that one name collision would make the WHOLE batch fail (createMany on
      // Postgres isn't atomic-per-row by default), silently blocking every OTHER default
      // category too. The one that collides is just skipped — see
      // scripts/backfill-finance-category-accounting-codes.ts's "legacy pre-Fase-1" bucket for
      // the actual remediation (archive the legacy row, which frees the name for this default
      // to be created on the next call).
      skipDuplicates: true,
      data: toCreate.map(c => ({
        key: c.key, name: c.name, type: c.type, accountingCode: c.accountingCode, description: c.description, section: c.section,
        associationId, isDefault: true,
      })),
    })
  }
  return toCreate.length
}

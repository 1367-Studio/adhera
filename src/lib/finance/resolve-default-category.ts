// src/lib/finance/resolve-default-category.ts
import { Prisma } from "@prisma/client"
import { defaultCategoryByKey } from "@/lib/finance/default-categories"

type DbClient = Prisma.TransactionClient

// Find-or-create a single default FinanceCategory by its stable `key`, for the payment code
// paths that set a real categoryId at creation time (cotisation-payments.ts, the Stripe
// webhook's Don/Participation branches, connect-stripe-fee.ts...). Can't assume
// ensureDefaultFinanceCategories already ran for this association — the seed route only runs
// when a treasurer first visits Comptabilité > Catégories — so this creates the single row it
// needs on demand instead, same fallback shape connect-stripe-fee.ts already used before this
// helper existed.
//
// IMPORTANT: always call this with the top-level `prisma` client, never with a `tx` from
// inside an open `prisma.$transaction(...)` callback. The P2002 retry below re-reads with a
// second query after the first one failed — inside a Postgres transaction, ANY failed
// statement aborts the whole transaction, so that second query would itself fail with "current
// transaction is aborted" instead of recovering. Resolve the category id first (outside any
// transaction), then open the transaction with the id already in hand — see
// cotisation-payments.ts, connect-stripe-fee.ts and boutique/book-income.ts for the pattern.
export async function getOrCreateDefaultCategory(db: DbClient, associationId: string, key: string): Promise<string | null> {
  // archivedAt: null — a treasurer may have archived this default category (it had history);
  // DELETE frees its `key` when that happens specifically so this lookup never finds and
  // silently keeps reusing a hidden, archived row for new transactions (see that route's doc
  // comment). This filter is defense-in-depth for the same reasoning, not the primary fix.
  const existing = await db.financeCategory.findFirst({
    where:  { associationId, key, archivedAt: null },
    select: { id: true },
  })
  if (existing) return existing.id

  const def = defaultCategoryByKey(key)
  if (!def) return null // Programmer error: `key` isn't one of DEFAULT_FINANCE_CATEGORIES.

  try {
    const created = await db.financeCategory.create({
      data:   { associationId, key: def.key, name: def.name, type: def.type, accountingCode: def.accountingCode, section: def.section, isDefault: true },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    // Two concurrent calls racing to create the same default category both hit the
    // @@unique([associationId, key]) constraint — the loser just re-reads what the winner
    // created instead of failing the whole payment write. Only recovers correctly when `db` is
    // the plain `prisma` client (see the warning above) — inside a `tx` this second query would
    // itself throw, which is exactly why callers must resolve this before opening a transaction.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raceWinner = await db.financeCategory.findFirst({ where: { associationId, key, archivedAt: null }, select: { id: true } })
      if (raceWinner) return raceWinner.id
    }
    throw error
  }
}

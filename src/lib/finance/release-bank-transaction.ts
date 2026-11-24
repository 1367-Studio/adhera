// src/lib/finance/release-bank-transaction.ts
import type { Prisma } from "@prisma/client"

type DbClient = Prisma.TransactionClient

// FORM-116 block 8 — since BankReconciliation stopped being 1:1 on bankTransactionId (a
// grouped Stripe payout can span several rows against the same transaction), every call site
// that used to reset a BankTransaction back to UNMATCHED whenever it dropped "its own"
// reconciliation row must first check whether any OTHER reconciliation row still points at
// that same transaction — otherwise deleting just one Income/Expense out of a reconciled group
// would wrongly unmatch a transaction still legitimately reconciled via its siblings, while
// those siblings' own BankReconciliation rows keep dangling at a now "UNMATCHED" transaction.
//
// Call this with `removingReconciliationIds` set to the id(s) of the BankReconciliation rows
// already deleted (or about to be deleted in the same transaction) — it filters
// `bankTransactionIds` down to only the ones with zero remaining reconciliation rows, safe to
// pass straight into a `bankTransaction.updateMany({ status: "UNMATCHED" })`. Can be called
// with either the plain `prisma` client (before an array-form `$transaction([...])`, since the
// deleteMany hasn't run yet — pass the reconciliation ids about to be removed) or a `tx` client
// from inside a callback-form transaction (after the deleteMany has already run — pass `[]`,
// since those rows are already gone from the count).
export async function bankTransactionIdsToRelease(
  db: DbClient,
  bankTransactionIds: string[],
  removingReconciliationIds: string[],
): Promise<string[]> {
  if (bankTransactionIds.length === 0) return []
  const stillLinked = await db.bankReconciliation.groupBy({
    by:    ["bankTransactionId"],
    where: { bankTransactionId: { in: bankTransactionIds }, id: { notIn: removingReconciliationIds } },
  })
  const stillLinkedIds = new Set(stillLinked.map(g => g.bankTransactionId))
  return bankTransactionIds.filter(id => !stillLinkedIds.has(id))
}

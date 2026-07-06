-- Defensively collapse any pre-existing duplicates (two BankReconciliation rows for the
-- same bank transaction, from the race this migration closes) before the unique
-- constraint below can be added — keeps the earliest match per transaction.
DELETE FROM "BankReconciliation" a
  USING "BankReconciliation" b
  WHERE a."bankTransactionId" = b."bankTransactionId"
    AND a."id" <> b."id"
    AND (a."matchedAt" > b."matchedAt" OR (a."matchedAt" = b."matchedAt" AND a."id" > b."id"));

-- DropIndex
DROP INDEX "BankReconciliation_bankTransactionId_idx";

-- A bank transaction can only ever be reconciled against one income/expense at a time —
-- enforcing this at the DB level (instead of only an app-level read-then-write check)
-- closes a race where two concurrent MATCH requests for the same transaction could each
-- pass the status check and both create a reconciliation row.
CREATE UNIQUE INDEX "BankReconciliation_bankTransactionId_key" ON "BankReconciliation"("bankTransactionId");

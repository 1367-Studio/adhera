-- FORM-116 block 8: a Stripe payout can net several Income/Expense rows into one bank
-- statement line (e.g. 3 charges minus their fees settling as 1 payout). BankReconciliation
-- was strictly 1:1 on bankTransactionId, so that line could never be reconciled at all. This
-- reopens the relation to 1 BankTransaction -> N BankReconciliation while keeping
-- incomeId/expenseId/reimbursementRequestId unique (each Income/Expense still belongs to at
-- most one reconciliation).

-- DropIndex
DROP INDEX "BankReconciliation_bankTransactionId_key";

-- CreateIndex
CREATE INDEX "BankReconciliation_bankTransactionId_idx" ON "BankReconciliation"("bankTransactionId");

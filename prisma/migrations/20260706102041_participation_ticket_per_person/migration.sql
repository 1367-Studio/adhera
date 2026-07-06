-- DropForeignKey
ALTER TABLE "Participation" DROP CONSTRAINT "Participation_membreId_fkey";

-- DropIndex
DROP INDEX "Participation_membreId_evenementId_key";

-- DropIndex
DROP INDEX "Participation_stripeSessionId_key";

-- AlterTable
ALTER TABLE "Participation" DROP COLUMN "paidQuantity",
DROP COLUMN "quantity",
ADD COLUMN     "amount" DECIMAL(10,2),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "orderId" TEXT,
ALTER COLUMN "membreId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_incomeId_key" ON "BankReconciliation"("incomeId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_expenseId_key" ON "BankReconciliation"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "Don_associationId_receiptNumber_key" ON "Don"("associationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "Participation_orderId_idx" ON "Participation"("orderId");

-- CreateIndex
CREATE INDEX "Participation_membreId_evenementId_idx" ON "Participation"("membreId", "evenementId");

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;


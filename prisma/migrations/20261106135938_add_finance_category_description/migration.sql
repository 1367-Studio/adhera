-- AlterTable
ALTER TABLE "FinanceCategory" ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE INDEX "FinanceCategory_associationId_key_idx" ON "FinanceCategory"("associationId", "key");

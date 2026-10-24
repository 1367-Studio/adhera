-- CreateEnum
CREATE TYPE "FinanceSection" AS ENUM ('OPERATING', 'FINANCIAL', 'EXCEPTIONAL', 'OTHER', 'IN_KIND');

-- AlterTable
ALTER TABLE "FinanceCategory" ADD COLUMN     "key" TEXT,
ADD COLUMN     "section" "FinanceSection" NOT NULL DEFAULT 'OPERATING';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "reference" TEXT,
ADD COLUMN     "isImmobilisation" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "FinanceCategory_associationId_key_idx" ON "FinanceCategory"("associationId", "key");

-- CreateIndex
CREATE INDEX "Expense_associationId_reference_idx" ON "Expense"("associationId", "reference");

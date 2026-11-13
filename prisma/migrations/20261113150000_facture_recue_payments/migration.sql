-- AlterEnum
ALTER TYPE "FactureRecueStatus" ADD VALUE 'PARTIELLEMENT_PAYEE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSourceType" ADD VALUE 'IMMOBILISATION_ACQUISITION';
ALTER TYPE "JournalSourceType" ADD VALUE 'FACTURE_RECUE_PAYMENT';

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_factureRecueId_fkey";

-- DropIndex
DROP INDEX "Expense_factureRecueId_key";

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "factureRecueId",
ADD COLUMN     "factureRecuePaymentId" TEXT;

-- AlterTable
ALTER TABLE "FactureRecue" ADD COLUMN     "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "factureRecuePaymentId" TEXT,
ADD COLUMN     "immobilisationId" TEXT;

-- CreateTable
CREATE TABLE "FactureRecuePayment" (
    "id" TEXT NOT NULL,
    "factureRecueId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureRecuePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureRecuePayment_factureRecueId_paidAt_idx" ON "FactureRecuePayment"("factureRecueId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_factureRecuePaymentId_key" ON "Expense"("factureRecuePaymentId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_factureRecuePaymentId_fkey" FOREIGN KEY ("factureRecuePaymentId") REFERENCES "FactureRecuePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_factureRecuePaymentId_fkey" FOREIGN KEY ("factureRecuePaymentId") REFERENCES "FactureRecuePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_immobilisationId_fkey" FOREIGN KEY ("immobilisationId") REFERENCES "Immobilisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureRecuePayment" ADD CONSTRAINT "FactureRecuePayment_factureRecueId_fkey" FOREIGN KEY ("factureRecueId") REFERENCES "FactureRecue"("id") ON DELETE CASCADE ON UPDATE CASCADE;


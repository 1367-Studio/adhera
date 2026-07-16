-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BoutiquePaymentMethod" ADD VALUE 'ESPECES';
ALTER TYPE "BoutiquePaymentMethod" ADD VALUE 'CHEQUE';
ALTER TYPE "BoutiquePaymentMethod" ADD VALUE 'CB';
ALTER TYPE "BoutiquePaymentMethod" ADD VALUE 'VIREMENT';

-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN     "manualPaymentType" "BoutiquePaymentMethod";

-- AlterTable
ALTER TABLE "BoutiqueProduit" ADD COLUMN     "categoryId" TEXT;

-- AddForeignKey
ALTER TABLE "BoutiqueProduit" ADD CONSTRAINT "BoutiqueProduit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

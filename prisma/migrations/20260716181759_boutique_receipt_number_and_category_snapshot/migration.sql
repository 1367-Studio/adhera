-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN     "receiptNumber" TEXT;

-- AlterTable
ALTER TABLE "BoutiqueCommandeItem" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BoutiqueCommande_associationId_receiptNumber_key" ON "BoutiqueCommande"("associationId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "BoutiqueCommandeItem" ADD CONSTRAINT "BoutiqueCommandeItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;


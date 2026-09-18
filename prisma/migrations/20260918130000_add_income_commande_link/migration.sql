-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "commandeId" TEXT;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_commandeId_fkey" FOREIGN KEY ("commandeId") REFERENCES "BoutiqueCommande"("id") ON DELETE SET NULL ON UPDATE CASCADE;

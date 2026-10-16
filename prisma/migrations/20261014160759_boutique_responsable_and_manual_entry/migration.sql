-- DropForeignKey
ALTER TABLE "ErasureRequest" DROP CONSTRAINT "ErasureRequest_requestedById_fkey";

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "boutiqueResponsableId" TEXT;

-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN     "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "BoutiqueCommande_associationId_membreId_idx" ON "BoutiqueCommande"("associationId", "membreId");

-- AddForeignKey
ALTER TABLE "Association" ADD CONSTRAINT "Association_boutiqueResponsableId_fkey" FOREIGN KEY ("boutiqueResponsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommande" ADD CONSTRAINT "BoutiqueCommande_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

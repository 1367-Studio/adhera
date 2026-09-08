-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN "trackingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BoutiqueCommande_trackingToken_key" ON "BoutiqueCommande"("trackingToken");

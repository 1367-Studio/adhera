-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "memberCardSettings" JSONB;

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "cardToken" TEXT,
ADD COLUMN     "cardTokenRotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Membre_cardToken_key" ON "Membre"("cardToken");

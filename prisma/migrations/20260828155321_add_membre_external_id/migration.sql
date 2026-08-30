-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "Membre_associationId_externalId_idx" ON "Membre"("associationId", "externalId");

-- AlterTable
ALTER TABLE "AssociationDocument" ADD COLUMN     "visibleToPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AssociationDocument_associationId_visibleToPublic_idx" ON "AssociationDocument"("associationId", "visibleToPublic");

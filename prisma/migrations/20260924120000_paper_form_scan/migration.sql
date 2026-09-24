-- Import de fiches papier : modèle de fiche propre à l'association (PaperFormTemplate) et
-- trois colonnes Membre alimentées par cet import (notes libres, droit à l'image).
-- Additif, aucune donnée touchée : les nouvelles colonnes Membre sont nullables (null =
-- jamais renseigné / jamais demandé).

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "imageRightsConsent" BOOLEAN,
ADD COLUMN     "imageRightsConsentAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "PaperFormTemplate" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pagesPerForm" INTEGER NOT NULL DEFAULT 1,
    "fields" JSONB NOT NULL,
    "identificationText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaperFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperFormTemplate_associationId_deletedAt_idx" ON "PaperFormTemplate"("associationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "PaperFormTemplate" ADD CONSTRAINT "PaperFormTemplate_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

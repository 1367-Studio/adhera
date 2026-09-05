ALTER TYPE "BoutiqueCommandeSource" ADD VALUE 'EVENEMENT';

CREATE TABLE "EvenementProduct" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvenementProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvenementProduct_evenementId_idx" ON "EvenementProduct"("evenementId");
CREATE UNIQUE INDEX "EvenementProduct_evenementId_varianteId_key" ON "EvenementProduct"("evenementId", "varianteId");

ALTER TABLE "EvenementProduct" ADD CONSTRAINT "EvenementProduct_evenementId_fkey" FOREIGN KEY ("evenementId") REFERENCES "Evenement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvenementProduct" ADD CONSTRAINT "EvenementProduct_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "BoutiqueVariante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BoutiqueCommande" ADD COLUMN "participationId" TEXT;
ALTER TABLE "BoutiqueCommande" ADD CONSTRAINT "BoutiqueCommande_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

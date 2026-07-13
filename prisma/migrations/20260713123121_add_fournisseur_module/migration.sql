-- CreateEnum
CREATE TYPE "FournisseurStatus" AS ENUM ('ACTIF', 'INACTIF', 'ARCHIVE');

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tradeName" TEXT,
    "contactName" TEXT,
    "contactRole" TEXT,
    "siret" TEXT,
    "siren" TEXT,
    "vatNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'France',
    "email" TEXT,
    "billingEmail" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "category" TEXT,
    "status" "FournisseurStatus" NOT NULL DEFAULT 'ACTIF',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FournisseurDocument" (
    "id" TEXT NOT NULL,
    "fournisseurId" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FournisseurDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fournisseur_associationId_status_idx" ON "Fournisseur"("associationId", "status");

-- CreateIndex
CREATE INDEX "Fournisseur_associationId_deletedAt_idx" ON "Fournisseur"("associationId", "deletedAt");

-- CreateIndex
CREATE INDEX "FournisseurDocument_fournisseurId_idx" ON "FournisseurDocument"("fournisseurId");

-- AddForeignKey
ALTER TABLE "Fournisseur" ADD CONSTRAINT "Fournisseur_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FournisseurDocument" ADD CONSTRAINT "FournisseurDocument_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

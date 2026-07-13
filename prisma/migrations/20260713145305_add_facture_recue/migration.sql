-- CreateEnum
CREATE TYPE "FactureRecueStatus" AS ENUM ('A_PAYER', 'PAYEE', 'EN_LITIGE', 'ANNULEE');

-- CreateTable
CREATE TABLE "FactureRecue" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "number" TEXT,
    "type" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "FactureRecueStatus" NOT NULL DEFAULT 'A_PAYER',
    "fileUrl" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FactureRecue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureRecue_associationId_status_idx" ON "FactureRecue"("associationId", "status");

-- CreateIndex
CREATE INDEX "FactureRecue_associationId_deletedAt_idx" ON "FactureRecue"("associationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "FactureRecue" ADD CONSTRAINT "FactureRecue_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureRecue" ADD CONSTRAINT "FactureRecue_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

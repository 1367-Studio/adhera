-- CreateEnum
CREATE TYPE "FactureStatus" AS ENUM ('BROUILLON', 'EN_ATTENTE', 'PARTIELLEMENT_PAYEE', 'PAYEE', 'EN_RETARD', 'ANNULEE');

-- CreateTable
CREATE TABLE "Facture" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "devisId" TEXT,
    "number" TEXT NOT NULL,
    "status" "FactureStatus" NOT NULL DEFAULT 'BROUILLON',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "paymentTerms" TEXT,
    "pdfUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Facture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureItem" (
    "id" TEXT NOT NULL,
    "factureId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FactureItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacturePayment" (
    "id" TEXT NOT NULL,
    "factureId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Facture_devisId_key" ON "Facture"("devisId");

-- CreateIndex
CREATE INDEX "Facture_associationId_status_idx" ON "Facture"("associationId", "status");

-- CreateIndex
CREATE INDEX "Facture_associationId_dueDate_idx" ON "Facture"("associationId", "dueDate");

-- CreateIndex
CREATE INDEX "Facture_associationId_deletedAt_idx" ON "Facture"("associationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Facture_associationId_number_key" ON "Facture"("associationId", "number");

-- CreateIndex
CREATE INDEX "FactureItem_factureId_idx" ON "FactureItem"("factureId");

-- CreateIndex
CREATE INDEX "FacturePayment_factureId_paidAt_idx" ON "FacturePayment"("factureId", "paidAt");

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureItem" ADD CONSTRAINT "FactureItem_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturePayment" ADD CONSTRAINT "FacturePayment_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "Facture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "BoutiqueCommandeSource" AS ENUM ('STOREFRONT', 'MEMBERSHIP_FORM');

-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN     "cotisationId" TEXT,
ADD COLUMN     "source" "BoutiqueCommandeSource" NOT NULL DEFAULT 'STOREFRONT';

-- CreateTable
CREATE TABLE "MembershipFormProduct" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipFormProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipFormProduct_formId_idx" ON "MembershipFormProduct"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipFormProduct_formId_varianteId_key" ON "MembershipFormProduct"("formId", "varianteId");

-- AddForeignKey
ALTER TABLE "MembershipFormProduct" ADD CONSTRAINT "MembershipFormProduct_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MembershipForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipFormProduct" ADD CONSTRAINT "MembershipFormProduct_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "BoutiqueVariante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommande" ADD CONSTRAINT "BoutiqueCommande_cotisationId_fkey" FOREIGN KEY ("cotisationId") REFERENCES "Cotisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

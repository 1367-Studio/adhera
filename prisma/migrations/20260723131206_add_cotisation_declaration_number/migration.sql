/*
  Warnings:

  - A unique constraint covering the columns `[associationId,declarationNumber]` on the table `Cotisation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "declarationIssuedAt" TIMESTAMP(3),
ADD COLUMN     "declarationNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Cotisation_associationId_declarationNumber_key" ON "Cotisation"("associationId", "declarationNumber");

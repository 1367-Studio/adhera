-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "receiptIssuedAt" TIMESTAMP(3),
ADD COLUMN     "receiptNumber" TEXT;

-- AlterTable
ALTER TABLE "CotisationSubscription" ADD COLUMN     "taxReceiptEligible" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Cotisation_associationId_receiptNumber_key" ON "Cotisation"("associationId", "receiptNumber");


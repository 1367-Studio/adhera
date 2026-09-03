-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "paymentToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Cotisation_paymentToken_key" ON "Cotisation"("paymentToken");

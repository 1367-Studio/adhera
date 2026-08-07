-- AlterTable
ALTER TABLE "Facture" ADD COLUMN     "materialLoanId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Facture_materialLoanId_key" ON "Facture"("materialLoanId");

-- AddForeignKey
ALTER TABLE "Facture" ADD CONSTRAINT "Facture_materialLoanId_fkey" FOREIGN KEY ("materialLoanId") REFERENCES "MaterialLoan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CotisationInstallmentPlan" ADD COLUMN     "cancelToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CotisationInstallmentPlan_cancelToken_key" ON "CotisationInstallmentPlan"("cancelToken");

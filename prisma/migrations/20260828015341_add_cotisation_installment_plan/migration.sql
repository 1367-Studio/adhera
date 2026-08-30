-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "installmentsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "installmentsCount" INTEGER DEFAULT 3;

-- CreateTable
CREATE TABLE "CotisationInstallmentPlan" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "cotisationId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "installmentsPaid" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotisationInstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CotisationInstallmentPlan_cotisationId_key" ON "CotisationInstallmentPlan"("cotisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CotisationInstallmentPlan_stripeSubscriptionId_key" ON "CotisationInstallmentPlan"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "CotisationInstallmentPlan_associationId_idx" ON "CotisationInstallmentPlan"("associationId");

-- AddForeignKey
ALTER TABLE "CotisationInstallmentPlan" ADD CONSTRAINT "CotisationInstallmentPlan_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotisationInstallmentPlan" ADD CONSTRAINT "CotisationInstallmentPlan_cotisationId_fkey" FOREIGN KEY ("cotisationId") REFERENCES "Cotisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


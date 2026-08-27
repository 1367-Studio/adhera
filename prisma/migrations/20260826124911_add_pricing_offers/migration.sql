-- CreateEnum
CREATE TYPE "PricingOfferStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "stripeSubscriptionScheduleId" TEXT;

-- CreateTable
CREATE TABLE "PricingOffer" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "planTier" "AssociationPlan" NOT NULL,
    "phases" JSONB NOT NULL,
    "stripeProductId" TEXT NOT NULL,
    "status" "PricingOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "associationId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingOffer_token_key" ON "PricingOffer"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PricingOffer_associationId_key" ON "PricingOffer"("associationId");

-- CreateIndex
CREATE INDEX "PricingOffer_status_idx" ON "PricingOffer"("status");

-- AddForeignKey
ALTER TABLE "PricingOffer" ADD CONSTRAINT "PricingOffer_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOffer" ADD CONSTRAINT "PricingOffer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

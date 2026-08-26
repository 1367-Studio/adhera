-- CreateEnum
CREATE TYPE "CotisationSubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "publicMembershipPaymentEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "CotisationSubscription" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "cancelToken" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "CotisationSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),

    CONSTRAINT "CotisationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CotisationSubscription_membreId_key" ON "CotisationSubscription"("membreId");

-- CreateIndex
CREATE UNIQUE INDEX "CotisationSubscription_stripeSubscriptionId_key" ON "CotisationSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CotisationSubscription_cancelToken_key" ON "CotisationSubscription"("cancelToken");

-- CreateIndex
CREATE INDEX "CotisationSubscription_associationId_status_idx" ON "CotisationSubscription"("associationId", "status");

-- CreateIndex
CREATE INDEX "Cotisation_subscriptionId_idx" ON "Cotisation"("subscriptionId");

-- AddForeignKey
ALTER TABLE "Cotisation" ADD CONSTRAINT "Cotisation_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CotisationSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotisationSubscription" ADD CONSTRAINT "CotisationSubscription_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotisationSubscription" ADD CONSTRAINT "CotisationSubscription_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "MembershipTierItemType" AS ENUM ('MEMBERSHIP', 'ADDON', 'DONATION');

-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "itemType" "MembershipTierItemType" NOT NULL DEFAULT 'MEMBERSHIP';

-- CreateTable
CREATE TABLE "MembershipAddonPurchase" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "cotisationId" TEXT,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipAddonPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipAddonPurchase_membreId_idx" ON "MembershipAddonPurchase"("membreId");

-- CreateIndex
CREATE INDEX "MembershipAddonPurchase_associationId_idx" ON "MembershipAddonPurchase"("associationId");

-- AddForeignKey
ALTER TABLE "MembershipAddonPurchase" ADD CONSTRAINT "MembershipAddonPurchase_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipAddonPurchase" ADD CONSTRAINT "MembershipAddonPurchase_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipAddonPurchase" ADD CONSTRAINT "MembershipAddonPurchase_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "MembershipTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipAddonPurchase" ADD CONSTRAINT "MembershipAddonPurchase_cotisationId_fkey" FOREIGN KEY ("cotisationId") REFERENCES "Cotisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

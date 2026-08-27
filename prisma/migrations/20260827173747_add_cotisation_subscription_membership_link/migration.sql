-- AlterTable
ALTER TABLE "CotisationSubscription" ADD COLUMN     "membershipFormId" TEXT,
ADD COLUMN     "tierId" TEXT;

-- CreateIndex
CREATE INDEX "CotisationSubscription_membershipFormId_idx" ON "CotisationSubscription"("membershipFormId");

-- CreateIndex
CREATE INDEX "CotisationSubscription_tierId_idx" ON "CotisationSubscription"("tierId");

-- AddForeignKey
ALTER TABLE "CotisationSubscription" ADD CONSTRAINT "CotisationSubscription_membershipFormId_fkey" FOREIGN KEY ("membershipFormId") REFERENCES "MembershipForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotisationSubscription" ADD CONSTRAINT "CotisationSubscription_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "MembershipTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

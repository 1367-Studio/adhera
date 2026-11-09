-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MembershipTierMergeLog" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "primaryTierId" TEXT NOT NULL,
    "secondaryTierId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "relationCounts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipTierMergeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipTierMergeLog_associationId_idx" ON "MembershipTierMergeLog"("associationId");

-- CreateIndex
CREATE INDEX "MembershipTierMergeLog_primaryTierId_idx" ON "MembershipTierMergeLog"("primaryTierId");

-- AddForeignKey
ALTER TABLE "MembershipTierMergeLog" ADD CONSTRAINT "MembershipTierMergeLog_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTierMergeLog" ADD CONSTRAINT "MembershipTierMergeLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

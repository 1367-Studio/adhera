-- AlterTable
ALTER TABLE "Don" ADD COLUMN     "membershipAddonTierId" TEXT;

-- CreateIndex
CREATE INDEX "Don_membershipAddonTierId_idx" ON "Don"("membershipAddonTierId");

-- AddForeignKey
ALTER TABLE "Don" ADD CONSTRAINT "Don_membershipAddonTierId_fkey" FOREIGN KEY ("membershipAddonTierId") REFERENCES "MembershipTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "pendingTierId" TEXT;

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_pendingTierId_fkey" FOREIGN KEY ("pendingTierId") REFERENCES "MembershipTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

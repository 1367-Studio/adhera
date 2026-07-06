-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "participationId" TEXT;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


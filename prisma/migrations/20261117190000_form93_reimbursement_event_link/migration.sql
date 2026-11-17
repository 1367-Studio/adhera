-- AlterTable
ALTER TABLE "ReimbursementRequest" ADD COLUMN     "eventId" TEXT;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Evenement"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'EVENT_REMINDER';

-- AlterTable
ALTER TABLE "AutomationLog" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "subject" TEXT;

-- AddForeignKey
ALTER TABLE "AutomationLog" ADD CONSTRAINT "AutomationLog_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

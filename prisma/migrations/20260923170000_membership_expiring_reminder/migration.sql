-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'MEMBERSHIP_EXPIRING';

-- AlterTable
ALTER TABLE "AutomationLog" ADD COLUMN     "cotisationId" TEXT;

-- CreateIndex
CREATE INDEX "AutomationLog_ruleId_cotisationId_idx" ON "AutomationLog"("ruleId", "cotisationId");

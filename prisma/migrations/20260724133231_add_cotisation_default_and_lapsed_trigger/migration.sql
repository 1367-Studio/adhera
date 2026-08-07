-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'EVENT_ADHERENT_LAPSED';

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "cotisationDefaultAmount" DECIMAL(10,2);

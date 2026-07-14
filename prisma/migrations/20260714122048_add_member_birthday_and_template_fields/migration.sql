-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'MEMBER_BIRTHDAY';

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'GENERAL';

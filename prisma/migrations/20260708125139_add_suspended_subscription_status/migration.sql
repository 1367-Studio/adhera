-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "suspendedAt" TIMESTAMP(3);

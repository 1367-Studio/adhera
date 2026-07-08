-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currentPeriodEndsAt" TIMESTAMP(3);

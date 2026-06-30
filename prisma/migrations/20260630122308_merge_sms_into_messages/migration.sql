/*
  Warnings:

  - You are about to drop the column `smsSettings` on the `Association` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS', 'BOTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TriggerType" ADD VALUE 'RSVP_CONFIRMED';
ALTER TYPE "TriggerType" ADD VALUE 'MEMBER_CREATED';

-- AlterTable
ALTER TABLE "Association" DROP COLUMN "smsSettings";

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "channel" "MessageChannel" NOT NULL DEFAULT 'EMAIL';

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "smsBody" TEXT;

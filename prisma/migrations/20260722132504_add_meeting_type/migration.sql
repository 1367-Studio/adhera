-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('AG', 'BUREAU', 'GENERALE');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "type" "MeetingType" NOT NULL DEFAULT 'GENERALE';

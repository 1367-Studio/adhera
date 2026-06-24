-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('CONFIRME', 'PROVAVEL', 'INCERTO', 'ABSENT');

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "rsvp" "RsvpStatus",
ADD COLUMN     "rsvpAt" TIMESTAMP(3);

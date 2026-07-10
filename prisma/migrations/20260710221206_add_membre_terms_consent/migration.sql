-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedIp" TEXT,
ADD COLUMN     "termsVersion" TEXT;

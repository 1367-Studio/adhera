-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "customDomainDnsRecords" JSONB,
ADD COLUMN     "customDomainStatus" "CustomDomainStatus",
ADD COLUMN     "customDomainVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Association_customDomain_key" ON "Association"("customDomain");

-- CreateIndex
CREATE INDEX "Association_customDomainStatus_idx" ON "Association"("customDomainStatus");


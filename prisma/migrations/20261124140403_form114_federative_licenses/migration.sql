-- CreateEnum
CREATE TYPE "MembershipLicenseBillingMode" AS ENUM ('INCLUDED', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "MembershipLicenseStatus" AS ENUM ('A_SOLICITAR', 'EM_ANDAMENTO', 'VALIDADA', 'A_RENOVAR');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "includeFederativeLicenseInAutoRenewal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CotisationSubscription" ADD COLUMN     "licenseApplies" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licenseDeclaredByMembre" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licenseFederation" TEXT,
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "licenseSeason" TEXT;

-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "licenseAdditionalAmount" DECIMAL(10,2),
ADD COLUMN     "licenseAllowDeclareExisting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licenseBillingMode" "MembershipLicenseBillingMode",
ADD COLUMN     "licenseEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licenseFederation" TEXT,
ADD COLUMN     "licenseMandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licenseName" TEXT,
ADD COLUMN     "licenseSeason" TEXT;

-- CreateTable
CREATE TABLE "MembershipLicense" (
    "id" TEXT NOT NULL,
    "cotisationId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "federation" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "status" "MembershipLicenseStatus" NOT NULL DEFAULT 'A_SOLICITAR',
    "declaredByMembre" BOOLEAN NOT NULL DEFAULT false,
    "autoRenewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipLicense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipLicense_cotisationId_key" ON "MembershipLicense"("cotisationId");

-- CreateIndex
CREATE INDEX "MembershipLicense_associationId_federation_season_status_idx" ON "MembershipLicense"("associationId", "federation", "season", "status");

-- CreateIndex
CREATE INDEX "MembershipLicense_membreId_idx" ON "MembershipLicense"("membreId");

-- AddForeignKey
ALTER TABLE "MembershipLicense" ADD CONSTRAINT "MembershipLicense_cotisationId_fkey" FOREIGN KEY ("cotisationId") REFERENCES "Cotisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipLicense" ADD CONSTRAINT "MembershipLicense_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipLicense" ADD CONSTRAINT "MembershipLicense_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

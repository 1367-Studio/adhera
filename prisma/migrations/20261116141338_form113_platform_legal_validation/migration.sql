-- CreateEnum
CREATE TYPE "PlatformLegalDocumentSlug" AS ENUM ('CGU', 'CGV', 'DPA', 'PRIVACY_POLICY', 'MENTIONS_LEGALES', 'ASSOCIATION_AUTHORIZATION');

-- CreateEnum
CREATE TYPE "PlatformLegalConfirmationType" AS ENUM ('ACCEPTATION', 'PRISE_DE_CONNAISSANCE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "requiresLegalValidation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PlatformLegalValidation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "documentSlug" "PlatformLegalDocumentSlug" NOT NULL,
    "version" INTEGER NOT NULL,
    "confirmationType" "PlatformLegalConfirmationType" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "PlatformLegalValidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLegalValidation_userId_documentSlug_version_key" ON "PlatformLegalValidation"("userId", "documentSlug", "version");

-- CreateIndex
CREATE INDEX "PlatformLegalValidation_associationId_idx" ON "PlatformLegalValidation"("associationId");

-- AddForeignKey
ALTER TABLE "PlatformLegalValidation" ADD CONSTRAINT "PlatformLegalValidation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformLegalValidation" ADD CONSTRAINT "PlatformLegalValidation_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

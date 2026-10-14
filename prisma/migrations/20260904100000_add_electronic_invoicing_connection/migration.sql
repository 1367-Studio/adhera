-- Hand-written to reconcile pre-existing drift: this was applied directly to the dev/stage
-- database on 2026-09-04 by work that never landed on this branch, so the migration file was
-- missing from the repo even though the table already exists live. Reproduces the live table
-- exactly (verified via \d "ElectronicInvoicingConnection" against the dev database) — not a
-- new change.
-- CreateEnum
CREATE TYPE "ElectronicInvoicingProvider" AS ENUM ('SUPER_PDP');

-- CreateEnum
CREATE TYPE "ElectronicInvoicingStatus" AS ENUM ('ACTIVE', 'ERROR');

-- CreateTable
CREATE TABLE "ElectronicInvoicingConnection" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "provider" "ElectronicInvoicingProvider" NOT NULL DEFAULT 'SUPER_PDP',
    "status" "ElectronicInvoicingStatus" NOT NULL DEFAULT 'ACTIVE',
    "companyId" TEXT,
    "companyName" TEXT,
    "companyNumber" TEXT,
    "companyNumberScheme" TEXT,
    "environment" TEXT,
    "companyVerificationStatus" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "lastError" TEXT,
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectronicInvoicingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ElectronicInvoicingConnection_associationId_key" ON "ElectronicInvoicingConnection"("associationId");

-- AddForeignKey
ALTER TABLE "ElectronicInvoicingConnection" ADD CONSTRAINT "ElectronicInvoicingConnection_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

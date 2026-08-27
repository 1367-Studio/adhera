-- CreateEnum
CREATE TYPE "MembershipFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MembershipFieldRequirement" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "MembershipFieldType" AS ENUM ('TEXT', 'NUMBER');

-- CreateEnum
CREATE TYPE "MembershipTierKind" AS ENUM ('ONE_OFF', 'RECURRING');

-- CreateEnum
CREATE TYPE "MembershipVisibility" AS ENUM ('LINK', 'SITE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MembershipValidationMode" AS ENUM ('IMMEDIATE', 'REQUEST');

-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "membershipFormId" TEXT,
ADD COLUMN     "tierId" TEXT;

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "answers" JSONB;

-- CreateTable
CREATE TABLE "MembershipForm" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MembershipFormStatus" NOT NULL DEFAULT 'DRAFT',
    "imageUrl" TEXT,
    "description" TEXT,
    "conditions" TEXT,
    "attachments" JSONB,
    "requireCguvSignature" BOOLEAN NOT NULL DEFAULT false,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "validationMode" "MembershipValidationMode" NOT NULL DEFAULT 'IMMEDIATE',
    "fieldAddress" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldBirthDate" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldPhone" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldMobile" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldGender" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "allowCash" BOOLEAN NOT NULL DEFAULT false,
    "allowCheque" BOOLEAN NOT NULL DEFAULT false,
    "allowTransfer" BOOLEAN NOT NULL DEFAULT false,
    "offlineInstructions" TEXT,
    "confirmationMessage" TEXT,
    "visibility" "MembershipVisibility" NOT NULL DEFAULT 'LINK',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipTier" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "MembershipTierKind" NOT NULL DEFAULT 'ONE_OFF',
    "free" BOOLEAN NOT NULL DEFAULT false,
    "freeAmount" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(10,2),
    "label" TEXT NOT NULL,
    "membreTypeId" TEXT,

    CONSTRAINT "MembershipTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipFormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" "MembershipFieldType" NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,

    CONSTRAINT "MembershipFormField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipForm_associationId_status_idx" ON "MembershipForm"("associationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipForm_associationId_slug_key" ON "MembershipForm"("associationId", "slug");

-- CreateIndex
CREATE INDEX "MembershipTier_formId_idx" ON "MembershipTier"("formId");

-- CreateIndex
CREATE INDEX "MembershipTier_membreTypeId_idx" ON "MembershipTier"("membreTypeId");

-- CreateIndex
CREATE INDEX "MembershipFormField_formId_idx" ON "MembershipFormField"("formId");

-- CreateIndex
CREATE INDEX "Cotisation_membershipFormId_idx" ON "Cotisation"("membershipFormId");

-- CreateIndex
CREATE INDEX "Cotisation_tierId_idx" ON "Cotisation"("tierId");

-- AddForeignKey
ALTER TABLE "Cotisation" ADD CONSTRAINT "Cotisation_membershipFormId_fkey" FOREIGN KEY ("membershipFormId") REFERENCES "MembershipForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotisation" ADD CONSTRAINT "Cotisation_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "MembershipTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipForm" ADD CONSTRAINT "MembershipForm_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTier" ADD CONSTRAINT "MembershipTier_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MembershipForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTier" ADD CONSTRAINT "MembershipTier_membreTypeId_fkey" FOREIGN KEY ("membreTypeId") REFERENCES "MembreType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipFormField" ADD CONSTRAINT "MembershipFormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MembershipForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

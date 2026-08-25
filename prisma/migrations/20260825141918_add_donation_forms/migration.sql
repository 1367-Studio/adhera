-- CreateEnum
CREATE TYPE "DonationFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DonationFieldRequirement" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "DonationFieldType" AS ENUM ('TEXT', 'NUMBER');

-- CreateEnum
CREATE TYPE "DonationTierKind" AS ENUM ('ONE_OFF', 'RECURRING');

-- CreateEnum
CREATE TYPE "DonationInterval" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "DonationReceiptMode" AS ENUM ('NONE', 'FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "DonationVisibility" AS ENUM ('LINK', 'SITE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "DonationSubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Don" ADD COLUMN     "answers" JSONB,
ADD COLUMN     "donationFormId" TEXT,
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "tierId" TEXT;

-- CreateTable
CREATE TABLE "DonationForm" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DonationFormStatus" NOT NULL DEFAULT 'DRAFT',
    "imageUrl" TEXT,
    "description" TEXT,
    "conditions" TEXT,
    "attachments" JSONB,
    "requireCguvSignature" BOOLEAN NOT NULL DEFAULT false,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "fieldAddress" "DonationFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldBirthDate" "DonationFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldPhone" "DonationFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldMobile" "DonationFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "fieldGender" "DonationFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
    "allowOnline" BOOLEAN NOT NULL DEFAULT true,
    "allowCash" BOOLEAN NOT NULL DEFAULT false,
    "allowCheque" BOOLEAN NOT NULL DEFAULT false,
    "allowTransfer" BOOLEAN NOT NULL DEFAULT false,
    "offlineInstructions" TEXT,
    "confirmationMessage" TEXT,
    "visibility" "DonationVisibility" NOT NULL DEFAULT 'LINK',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationTier" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "DonationTierKind" NOT NULL DEFAULT 'ONE_OFF',
    "freeAmount" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(10,2),
    "interval" "DonationInterval",
    "label" TEXT NOT NULL,
    "receiptMode" "DonationReceiptMode" NOT NULL DEFAULT 'FULL',
    "deductibleAmount" DECIMAL(10,2),

    CONSTRAINT "DonationTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationFormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" "DonationFieldType" NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,

    CONSTRAINT "DonationFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationSubscription" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "donationFormId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "interval" "DonationInterval" NOT NULL,
    "status" "DonationSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),

    CONSTRAINT "DonationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DonationForm_associationId_status_idx" ON "DonationForm"("associationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DonationForm_associationId_slug_key" ON "DonationForm"("associationId", "slug");

-- CreateIndex
CREATE INDEX "DonationTier_formId_idx" ON "DonationTier"("formId");

-- CreateIndex
CREATE INDEX "DonationFormField_formId_idx" ON "DonationFormField"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "DonationSubscription_stripeSubscriptionId_key" ON "DonationSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "DonationSubscription_associationId_status_idx" ON "DonationSubscription"("associationId", "status");

-- CreateIndex
CREATE INDEX "DonationSubscription_donationFormId_idx" ON "DonationSubscription"("donationFormId");

-- CreateIndex
CREATE INDEX "Don_membreId_idx" ON "Don"("membreId");

-- CreateIndex
CREATE INDEX "Don_donationFormId_idx" ON "Don"("donationFormId");

-- CreateIndex
CREATE INDEX "Don_subscriptionId_idx" ON "Don"("subscriptionId");

-- AddForeignKey
ALTER TABLE "Don" ADD CONSTRAINT "Don_donationFormId_fkey" FOREIGN KEY ("donationFormId") REFERENCES "DonationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Don" ADD CONSTRAINT "Don_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "DonationTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Don" ADD CONSTRAINT "Don_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "DonationSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationForm" ADD CONSTRAINT "DonationForm_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationTier" ADD CONSTRAINT "DonationTier_formId_fkey" FOREIGN KEY ("formId") REFERENCES "DonationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationFormField" ADD CONSTRAINT "DonationFormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "DonationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationSubscription" ADD CONSTRAINT "DonationSubscription_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationSubscription" ADD CONSTRAINT "DonationSubscription_donationFormId_fkey" FOREIGN KEY ("donationFormId") REFERENCES "DonationForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationSubscription" ADD CONSTRAINT "DonationSubscription_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "DonationTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

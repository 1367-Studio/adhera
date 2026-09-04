-- Bring Evenement up to the same wizard shape as MembershipForm/DonationForm: a draft/publish
-- status, an offline-payment step (Participation.paymentMethod mirrors Don.paymentMethod), a
-- standard-field requirement matrix for phone/address, and per-tier fiscal receipt eligibility.
-- Every existing row is backfilled to reproduce its exact current public behavior — see the
-- UPDATE statements below each ADD COLUMN.

-- CreateEnum
CREATE TYPE "EvenementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EvenementVisibility" AS ENUM ('LINK', 'PRIVATE');

-- CreateEnum
CREATE TYPE "EvenementFieldRequirement" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "EvenementPaymentMethod" AS ENUM ('STRIPE', 'ESPECES', 'CHEQUE', 'VIREMENT');

-- AlterTable
-- status defaults to DRAFT for the column (correct for anything created from now on via the
-- new quick-create modal), but every event that already existed before this migration was
-- always instantly public via its copy-link — backfill those to PUBLISHED so nothing that's
-- already been shared goes dark.
ALTER TABLE "Evenement" ADD COLUMN     "allowCash" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowCheque" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowTransfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "confirmationMessage" TEXT,
ADD COLUMN     "fieldAddress" "EvenementFieldRequirement" NOT NULL DEFAULT 'OPTIONAL',
ADD COLUMN     "fieldPhone" "EvenementFieldRequirement" NOT NULL DEFAULT 'OPTIONAL',
ADD COLUMN     "offlineInstructions" TEXT,
ADD COLUMN     "opensAt" TIMESTAMP(3),
ADD COLUMN     "status" "EvenementStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "visibility" "EvenementVisibility" NOT NULL DEFAULT 'LINK';

UPDATE "Evenement" SET "status" = 'PUBLISHED';

-- AlterTable
-- receiptMode defaults to NONE, which is also the correct backfill — no event ticket has ever
-- issued a fiscal receipt before this column existed.
ALTER TABLE "EvenementTicketType" ADD COLUMN     "ineligibleAmount" DECIMAL(10,2),
ADD COLUMN     "receiptMode" "DonationReceiptMode" NOT NULL DEFAULT 'NONE';

-- AlterTable
-- associationId is denormalized from evenement.associationId (needed for per-association/year
-- receipt numbering, same convention as Cotisation/Don/BoutiqueCommande) and paymentMethod/
-- receiptMode/deductibleAmount/receiptNumber/receiptIssuedAt are all nullable-by-default —
-- nothing to backfill for those. associationId itself must be backfilled from the parent
-- Evenement before it can be made required, since existing Participation rows predate it.
ALTER TABLE "Participation" ADD COLUMN     "associationId" TEXT,
ADD COLUMN     "deductibleAmount" DECIMAL(10,2),
ADD COLUMN     "paymentMethod" "EvenementPaymentMethod",
ADD COLUMN     "receiptIssuedAt" TIMESTAMP(3),
ADD COLUMN     "receiptMode" "DonationReceiptMode",
ADD COLUMN     "receiptNumber" TEXT;

UPDATE "Participation" p SET "associationId" = e."associationId"
  FROM "Evenement" e WHERE e."id" = p."evenementId";

ALTER TABLE "Participation" ALTER COLUMN "associationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Evenement_associationId_status_idx" ON "Evenement"("associationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_associationId_receiptNumber_key" ON "Participation"("associationId", "receiptNumber");

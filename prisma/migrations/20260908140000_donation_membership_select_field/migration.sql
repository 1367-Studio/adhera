-- Additive-only: new enum value + nullable column per module, no backfill needed —
-- mirrors the "SELECT" custom-field type already available on Evenement.

-- AlterEnum
ALTER TYPE "DonationFieldType" ADD VALUE 'SELECT';
ALTER TYPE "MembershipFieldType" ADD VALUE 'SELECT';

-- AlterTable
ALTER TABLE "DonationFormField" ADD COLUMN "options" JSONB;
ALTER TABLE "MembershipFormField" ADD COLUMN "options" JSONB;

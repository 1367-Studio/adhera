-- Additive-only: new enum values, no backfill needed — brings Donation custom fields to
-- parity with the RADIO/CHECKBOX_MULTI types already available on Evenement.

-- AlterEnum
ALTER TYPE "DonationFieldType" ADD VALUE 'RADIO';
ALTER TYPE "DonationFieldType" ADD VALUE 'CHECKBOX_MULTI';

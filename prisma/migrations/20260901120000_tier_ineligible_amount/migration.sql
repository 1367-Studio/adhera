-- MembershipTier.deductibleAmount and DonationTier.deductibleAmount used to hold the
-- eligible amount directly (admin typed the receipt figure). They now hold the amount NOT
-- eligible for the tax receipt instead (admin types e.g. the value of a counterpart
-- received in exchange), with the eligible amount computed automatically downstream (see
-- eligibleReceiptAmount in src/lib/receipt-eligibility.ts) as (amount paid − ineligibleAmount).
-- Invert the already-configured values so existing PARTIAL tiers keep producing the exact
-- same eligible receipt amount as before this migration.
ALTER TABLE "MembershipTier" RENAME COLUMN "deductibleAmount" TO "ineligibleAmount";
UPDATE "MembershipTier" SET "ineligibleAmount" = "amount" - "ineligibleAmount"
  WHERE "receiptMode" = 'PARTIAL' AND "ineligibleAmount" IS NOT NULL AND "amount" IS NOT NULL;

ALTER TABLE "DonationTier" RENAME COLUMN "deductibleAmount" TO "ineligibleAmount";
UPDATE "DonationTier" SET "ineligibleAmount" = "amount" - "ineligibleAmount"
  WHERE "receiptMode" = 'PARTIAL' AND "ineligibleAmount" IS NOT NULL AND "amount" IS NOT NULL;

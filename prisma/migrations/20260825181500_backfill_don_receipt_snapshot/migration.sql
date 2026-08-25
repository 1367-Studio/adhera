-- Backfill Don.receiptMode/deductibleAmount and DonationSubscription.receiptMode/deductibleAmount
-- for rows created before these columns existed, from their (still-live-at-migration-time)
-- DonationTier. Without this, a pre-existing Don whose tier had receiptMode = 'NONE' would
-- start getting a receipt after the app deploy, since NULL <> 'NONE' is true in the new code.
UPDATE "Don" d
SET "receiptMode" = t."receiptMode",
    "deductibleAmount" = t."deductibleAmount"
FROM "DonationTier" t
WHERE d."tierId" = t.id
  AND d."receiptMode" IS NULL;

UPDATE "DonationSubscription" s
SET "receiptMode" = t."receiptMode",
    "deductibleAmount" = t."deductibleAmount"
FROM "DonationTier" t
WHERE s."tierId" = t.id
  AND s."receiptMode" IS NULL;

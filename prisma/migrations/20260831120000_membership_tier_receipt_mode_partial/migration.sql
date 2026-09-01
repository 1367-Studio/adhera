-- Replace the boolean "taxReceiptEligible" on MembershipTier/Cotisation/CotisationSubscription
-- with the same receiptMode (NONE/FULL/PARTIAL) + deductibleAmount pair already used by
-- DonationTier/Don, so a membership tier can be marked partially tax-deductible.

-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "receiptMode" "DonationReceiptMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "deductibleAmount" DECIMAL(10,2);
UPDATE "MembershipTier" SET "receiptMode" = 'FULL' WHERE "taxReceiptEligible" = true;
ALTER TABLE "MembershipTier" DROP COLUMN "taxReceiptEligible";

-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "receiptMode" "DonationReceiptMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "deductibleAmount" DECIMAL(10,2);
UPDATE "Cotisation" SET "receiptMode" = 'FULL' WHERE "taxReceiptEligible" = true;
ALTER TABLE "Cotisation" DROP COLUMN "taxReceiptEligible";

-- AlterTable
ALTER TABLE "CotisationSubscription" ADD COLUMN     "receiptMode" "DonationReceiptMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "deductibleAmount" DECIMAL(10,2);
UPDATE "CotisationSubscription" SET "receiptMode" = 'FULL' WHERE "taxReceiptEligible" = true;
ALTER TABLE "CotisationSubscription" DROP COLUMN "taxReceiptEligible";

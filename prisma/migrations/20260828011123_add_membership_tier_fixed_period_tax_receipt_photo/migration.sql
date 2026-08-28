-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "taxReceiptEligible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MembershipForm" ADD COLUMN     "fieldPhoto" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN';

-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "fixedPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "taxReceiptEligible" BOOLEAN NOT NULL DEFAULT false;

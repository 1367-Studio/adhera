-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CotisationSubscription" ADD COLUMN     "durationMonths" INTEGER;

-- AlterTable
ALTER TABLE "MembershipTier" ADD COLUMN     "durationMonths" INTEGER;

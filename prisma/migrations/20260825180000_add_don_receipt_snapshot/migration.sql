-- AlterTable
ALTER TABLE "Don" ADD COLUMN     "deductibleAmount" DECIMAL(10,2),
ADD COLUMN     "receiptMode" "DonationReceiptMode";

-- AlterTable
ALTER TABLE "DonationSubscription" ADD COLUMN     "deductibleAmount" DECIMAL(10,2),
ADD COLUMN     "receiptMode" "DonationReceiptMode";

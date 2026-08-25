-- AlterTable
ALTER TABLE "DonationSubscription" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "answers" JSONB,
ADD COLUMN     "cancelToken" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "donorType" "DonorType" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "message" TEXT,
ADD COLUMN     "siret" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DonationSubscription_cancelToken_key" ON "DonationSubscription"("cancelToken");

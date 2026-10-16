-- Admin "add manual donation" form: a 4th offline payment method, and a marker that
-- distinguishes a donation an admin typed in directly from one a donor submitted and an
-- admin merely confirmed ("encaisser") — both can end up with the same paymentMethod and
-- paidAt otherwise. Additive-only: new enum value + one nullable FK column, no backfill.

-- AlterEnum
ALTER TYPE "DonPaymentMethod" ADD VALUE 'AUTRE';

-- AlterTable
ALTER TABLE "Don" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Don_createdByUserId_idx" ON "Don"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Don" ADD CONSTRAINT "Don_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

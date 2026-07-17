-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- Backfill: for orders already PAID before this column existed, `updatedAt` is the best
-- available approximation of when they were paid — as long as no correction has touched
-- the row since, this is exact.
UPDATE "BoutiqueCommande" SET "paidAt" = "updatedAt" WHERE "status" = 'PAID' AND "paidAt" IS NULL;

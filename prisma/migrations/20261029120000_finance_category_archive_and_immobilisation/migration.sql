-- AlterEnum
ALTER TYPE "FinanceSection" ADD VALUE 'IMMOBILISATION';

-- AlterTable
ALTER TABLE "FinanceCategory" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- DropIndex (was a plain index, superseded by a real uniqueness constraint added in the
-- follow-up migration 20261029130000_finance_category_unique_constraints — split into two
-- migrations deliberately: a database with pre-existing duplicate categories/keys must run
-- scripts/merge-duplicate-finance-categories.ts between the two, or the unique index creation
-- in the follow-up migration fails outright on that existing data).
DROP INDEX "FinanceCategory_associationId_key_idx";

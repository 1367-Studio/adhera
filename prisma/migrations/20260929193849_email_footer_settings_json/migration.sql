-- AlterTable
ALTER TABLE "Association" DROP COLUMN "emailFooterText",
ADD COLUMN "emailFooterSettings" JSONB;

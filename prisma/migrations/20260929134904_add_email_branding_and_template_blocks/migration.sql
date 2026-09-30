-- AlterTable
ALTER TABLE "Association" ADD COLUMN "emailSenderName" TEXT,
ADD COLUMN "emailSignature" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN "blocks" JSONB;

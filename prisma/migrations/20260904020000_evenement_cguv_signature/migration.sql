ALTER TABLE "Evenement" ADD COLUMN "conditions" TEXT;
ALTER TABLE "Evenement" ADD COLUMN "attachments" JSONB;
ALTER TABLE "Evenement" ADD COLUMN "requireCguvSignature" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Participation" ADD COLUMN "cguvAgreedAt" TIMESTAMP(3);
ALTER TABLE "Participation" ADD COLUMN "signedName" TEXT;

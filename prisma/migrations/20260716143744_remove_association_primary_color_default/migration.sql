-- AlterTable
ALTER TABLE "Association" ALTER COLUMN "primaryColor" DROP DEFAULT;

-- Backfill: rows still holding the literal ex-default were never actually customized by
-- an admin (the branding-settings/site-builder forms only persist this value on save,
-- and nobody types "#6366f1" by hand) — null them out so canUseCustomBranding()/
-- resolveDocumentBranding() stop treating "never configured" as "customized purple"
-- across the dashboard/portal theme, PDFs, check-in page and now emails.
UPDATE "Association" SET "primaryColor" = NULL WHERE "primaryColor" = '#6366f1';

-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN "requiresPreparation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BoutiqueCommande" ADD COLUMN "preparedAt" TIMESTAMP(3);

-- Backfill: every PAID order that already existed before this migration is historical —
-- without this, the dashboard's new "Commandes boutique à préparer" action (FORM-119) would
-- instantly count every past sale an association ever recorded as "needing preparation" the
-- moment this ships. Stamping preparedAt now means only orders paid AFTER this migration
-- runs are new/actionable.
UPDATE "BoutiqueCommande" SET "preparedAt" = COALESCE("paidAt", "createdAt") WHERE "status" = 'PAID';

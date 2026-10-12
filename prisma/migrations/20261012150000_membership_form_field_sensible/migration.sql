-- Marque un champ personnalisé d'adhésion comme donnée sensible (RGPD Art. 9), soumis à la
-- permission "sensible" au même titre que groupeSanguin/allergies/guardian* sur Membre.
-- AlterTable
ALTER TABLE "MembershipFormField" ADD COLUMN     "sensible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Evenement" ADD COLUMN     "fieldCountry" "EvenementFieldRequirement" NOT NULL DEFAULT 'OPTIONAL';

-- AlterTable
ALTER TABLE "DonationForm" ADD COLUMN     "fieldCountry" "DonationFieldRequirement" NOT NULL DEFAULT 'HIDDEN';

-- AlterTable
ALTER TABLE "MembershipForm" ADD COLUMN     "fieldCountry" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN';

-- Avant FORM-108, le pays s'affichait et se validait toujours avec le reste de l'adresse :
-- aucun réglage indépendant n'existait. Pour que les formulaires déjà configurés continuent
-- de se comporter exactement pareil après l'introduction de fieldCountry, on recopie la
-- valeur actuelle de fieldAddress plutôt que de laisser le default ci-dessus s'appliquer.
UPDATE "Evenement" SET "fieldCountry" = "fieldAddress";
UPDATE "DonationForm" SET "fieldCountry" = "fieldAddress";
UPDATE "MembershipForm" SET "fieldCountry" = "fieldAddress";

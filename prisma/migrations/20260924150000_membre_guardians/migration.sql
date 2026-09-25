-- Responsables légaux saisis en texte sur la fiche de l'élève (mère / père lus sur une fiche
-- papier, ou saisis à la main) — distincts de responsableId, qui lie un autre membre.
-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "guardianName" TEXT,
ADD COLUMN     "guardianPhone" TEXT,
ADD COLUMN     "secondGuardianName" TEXT,
ADD COLUMN     "secondGuardianPhone" TEXT;

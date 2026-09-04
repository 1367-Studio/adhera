-- Closes the remaining AssoConnect field-parity gap on the "Formulaire" step: birthDate,
-- gender and mobile phone, mirroring MembershipForm.fieldBirthDate/fieldGender/fieldMobile.
-- All new columns default to HIDDEN/null, which is also the correct backfill — none of these
-- were ever collected on an event before this migration, so no existing row's behavior
-- changes and no UPDATE is needed.

-- AlterTable
ALTER TABLE "Evenement" ADD COLUMN     "fieldBirthDate" "EvenementFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
ADD COLUMN     "fieldGender" "EvenementFieldRequirement" NOT NULL DEFAULT 'HIDDEN',
ADD COLUMN     "fieldMobile" "EvenementFieldRequirement" NOT NULL DEFAULT 'HIDDEN';

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "gender" "Sexe";

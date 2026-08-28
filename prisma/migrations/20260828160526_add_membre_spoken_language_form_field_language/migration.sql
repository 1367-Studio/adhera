-- AlterTable
ALTER TABLE "MembershipForm" ADD COLUMN     "fieldLanguage" "MembershipFieldRequirement" NOT NULL DEFAULT 'HIDDEN';

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "spokenLanguage" TEXT;

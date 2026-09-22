-- AlterTable
ALTER TABLE "Don" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "DonationSubscription" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT;

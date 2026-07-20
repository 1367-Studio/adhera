-- CreateEnum
CREATE TYPE "Civilite" AS ENUM ('MME', 'MLLE', 'M');

-- CreateEnum
CREATE TYPE "GroupeSanguin" AS ENUM ('A_POSITIF', 'A_NEGATIF', 'B_POSITIF', 'B_NEGATIF', 'AB_POSITIF', 'AB_NEGATIF', 'O_POSITIF', 'O_NEGATIF');

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "civilite" "Civilite",
ADD COLUMN     "groupeSanguin" "GroupeSanguin";

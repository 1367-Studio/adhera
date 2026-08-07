-- CreateEnum
CREATE TYPE "Sexe" AS ENUM ('HOMME', 'FEMME');

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "sexe" "Sexe";

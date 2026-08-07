-- CreateEnum
CREATE TYPE "TailleTshirt" AS ENUM ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL');

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "possedeTshirt" BOOLEAN,
ADD COLUMN     "responsableId" TEXT,
ADD COLUMN     "tailleTshirt" "TailleTshirt";

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

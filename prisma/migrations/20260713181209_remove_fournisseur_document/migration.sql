/*
  Warnings:

  - You are about to drop the `FournisseurDocument` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FournisseurDocument" DROP CONSTRAINT "FournisseurDocument_fournisseurId_fkey";

-- DropTable
DROP TABLE "FournisseurDocument";

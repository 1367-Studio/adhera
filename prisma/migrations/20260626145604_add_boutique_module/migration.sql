-- CreateEnum
CREATE TYPE "BoutiqueProduitStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BoutiqueCommandeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BoutiquePaymentMethod" AS ENUM ('STRIPE', 'MANUAL');

-- CreateTable
CREATE TABLE "BoutiqueProduit" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "status" "BoutiqueProduitStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoutiqueProduit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoutiqueVariante" (
    "id" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoutiqueVariante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoutiqueCommande" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "membreId" TEXT,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "status" "BoutiqueCommandeStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "BoutiquePaymentMethod" NOT NULL DEFAULT 'MANUAL',
    "stripePaymentIntentId" TEXT,
    "totalAmount" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoutiqueCommande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoutiqueCommandeItem" (
    "id" TEXT NOT NULL,
    "commandeId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,

    CONSTRAINT "BoutiqueCommandeItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BoutiqueProduit" ADD CONSTRAINT "BoutiqueProduit_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueVariante" ADD CONSTRAINT "BoutiqueVariante_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "BoutiqueProduit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommande" ADD CONSTRAINT "BoutiqueCommande_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommande" ADD CONSTRAINT "BoutiqueCommande_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommandeItem" ADD CONSTRAINT "BoutiqueCommandeItem_commandeId_fkey" FOREIGN KEY ("commandeId") REFERENCES "BoutiqueCommande"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommandeItem" ADD CONSTRAINT "BoutiqueCommandeItem_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "BoutiqueProduit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoutiqueCommandeItem" ADD CONSTRAINT "BoutiqueCommandeItem_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "BoutiqueVariante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

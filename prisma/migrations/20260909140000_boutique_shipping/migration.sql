-- CreateEnum
CREATE TYPE "BoutiqueDeliveryMethod" AS ENUM ('PICKUP', 'DELIVERY');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingCity" TEXT,
ADD COLUMN     "shippingCountry" TEXT DEFAULT 'FR',
ADD COLUMN     "shippingPostalCode" TEXT;

-- AlterTable
ALTER TABLE "BoutiqueVariante" ADD COLUMN     "shippable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weightGrams" INTEGER;

-- AlterTable
ALTER TABLE "BoutiqueCommande" ADD COLUMN     "deliveryMethod" "BoutiqueDeliveryMethod" NOT NULL DEFAULT 'PICKUP',
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingCarrierLabel" TEXT,
ADD COLUMN     "shippingCity" TEXT,
ADD COLUMN     "shippingCost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingCountry" TEXT,
ADD COLUMN     "shippingPostalCode" TEXT;

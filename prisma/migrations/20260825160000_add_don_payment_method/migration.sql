-- CreateEnum
CREATE TYPE "DonPaymentMethod" AS ENUM ('STRIPE', 'ESPECES', 'CHEQUE', 'VIREMENT');

-- AlterTable
ALTER TABLE "Don" ADD COLUMN     "paymentMethod" "DonPaymentMethod";

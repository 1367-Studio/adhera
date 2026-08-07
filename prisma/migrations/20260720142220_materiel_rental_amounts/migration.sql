-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "rentalRate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "MaterialLoan" ADD COLUMN     "feeAmount" DECIMAL(10,2);

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('DEMANDE', 'CONFIRME', 'REFUSE');

-- AlterTable
ALTER TABLE "MaterialLoan" ADD COLUMN     "status" "LoanStatus" NOT NULL DEFAULT 'CONFIRME';

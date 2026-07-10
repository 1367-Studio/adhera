-- CreateEnum
CREATE TYPE "AssociationPlan" AS ENUM ('ESSENTIAL', 'PRO');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "plan" "AssociationPlan" NOT NULL DEFAULT 'ESSENTIAL';

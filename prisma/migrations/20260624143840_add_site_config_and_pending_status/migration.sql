-- AlterEnum
ALTER TYPE "MembreStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "siteConfig" JSONB,
ADD COLUMN     "sitePublished" BOOLEAN NOT NULL DEFAULT false;

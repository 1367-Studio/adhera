-- CreateEnum
CREATE TYPE "SiteBuilder" AS ENUM ('LEGACY', 'PUCK');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN "siteBuilder" "SiteBuilder" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "sitePuckPublished" JSONB,
ADD COLUMN "sitePuckPublishedAt" TIMESTAMP(3);

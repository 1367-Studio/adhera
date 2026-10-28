-- CreateEnum
CREATE TYPE "SitePageNavDisplay" AS ENUM ('BUTTON', 'DROPDOWN');

-- AlterTable
ALTER TABLE "SitePage" ADD COLUMN "navDisplay" "SitePageNavDisplay" NOT NULL DEFAULT 'BUTTON';

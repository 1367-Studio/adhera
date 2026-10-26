-- CreateTable
CREATE TABLE "SiteNavMenu" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteNavMenu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteNavMenu_associationId_idx" ON "SiteNavMenu"("associationId");

-- AddForeignKey
ALTER TABLE "SiteNavMenu" ADD CONSTRAINT "SiteNavMenu_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "SitePage" ADD COLUMN "navMenuId" TEXT;

-- CreateIndex
CREATE INDEX "SitePage_navMenuId_idx" ON "SitePage"("navMenuId");

-- AddForeignKey
ALTER TABLE "SitePage" ADD CONSTRAINT "SitePage_navMenuId_fkey" FOREIGN KEY ("navMenuId") REFERENCES "SiteNavMenu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The single shared "Pages" dropdown is replaced by any number of named SiteNavMenu entries —
-- navMenuId above expresses the same "which dropdown" choice per page, generalized.
ALTER TABLE "SitePage" DROP COLUMN "navDisplay";

-- DropEnum
DROP TYPE "SitePageNavDisplay";

-- CreateEnum
CREATE TYPE "SitePageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "SitePage" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "SitePageStatus" NOT NULL DEFAULT 'DRAFT',
    "draftContent" JSONB NOT NULL,
    "publishedContent" JSONB,
    "publishedAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "showInNav" BOOLEAN NOT NULL DEFAULT false,
    "navLabel" TEXT,
    "navPosition" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SitePage_associationId_status_idx" ON "SitePage"("associationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SitePage_associationId_slug_key" ON "SitePage"("associationId", "slug");

-- AddForeignKey
ALTER TABLE "SitePage" ADD CONSTRAINT "SitePage_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

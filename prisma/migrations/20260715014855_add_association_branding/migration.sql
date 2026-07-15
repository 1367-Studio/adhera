-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "customBrandingEnabled" BOOLEAN,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "primaryColor" TEXT DEFAULT '#6366f1',
ADD COLUMN     "secondaryColor" TEXT;

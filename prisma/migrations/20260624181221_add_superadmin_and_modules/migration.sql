-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "modules" JSONB;

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'EQUIPE' BEFORE 'MEMBRE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "permissions" JSONB;

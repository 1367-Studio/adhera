-- CreateEnum
CREATE TYPE "EvenementFieldType" AS ENUM ('TEXT', 'NUMBER');

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "address" TEXT,
ADD COLUMN     "answers" JSONB,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "EvenementCustomField" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "type" "EvenementFieldType" NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,

    CONSTRAINT "EvenementCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvenementCustomField_evenementId_idx" ON "EvenementCustomField"("evenementId");

-- AddForeignKey
ALTER TABLE "EvenementCustomField" ADD CONSTRAINT "EvenementCustomField_evenementId_fkey" FOREIGN KEY ("evenementId") REFERENCES "Evenement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

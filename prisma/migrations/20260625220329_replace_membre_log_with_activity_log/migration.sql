/*
  Warnings:

  - You are about to drop the `MembreLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MembreLog" DROP CONSTRAINT "MembreLog_associationId_fkey";

-- DropForeignKey
ALTER TABLE "MembreLog" DROP CONSTRAINT "MembreLog_membreId_fkey";

-- DropTable
DROP TABLE "MembreLog";

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "label" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_associationId_createdAt_idx" ON "ActivityLog"("associationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_associationId_entity_idx" ON "ActivityLog"("associationId", "entity");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

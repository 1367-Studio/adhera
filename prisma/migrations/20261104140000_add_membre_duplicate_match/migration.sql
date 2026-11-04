-- CreateEnum
CREATE TYPE "MembreDuplicateMatchStatus" AS ENUM ('PENDING', 'DISMISSED', 'MERGED');

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedById" TEXT,
ADD COLUMN     "mergedIntoId" TEXT;

-- CreateTable
CREATE TABLE "MembreDuplicateMatch" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "membreAId" TEXT NOT NULL,
    "membreBId" TEXT NOT NULL,
    "matchedFields" TEXT[],
    "status" "MembreDuplicateMatchStatus" NOT NULL DEFAULT 'PENDING',
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "autoDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembreDuplicateMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembreMergeLog" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "primaryMembreId" TEXT NOT NULL,
    "secondaryMembreId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "fieldResolutions" JSONB NOT NULL,
    "relationCounts" JSONB NOT NULL,
    "conflicts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembreMergeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembreDuplicateMatch_membreAId_membreBId_key" ON "MembreDuplicateMatch"("membreAId", "membreBId");

-- CreateIndex
CREATE INDEX "MembreDuplicateMatch_associationId_status_idx" ON "MembreDuplicateMatch"("associationId", "status");

-- CreateIndex
CREATE INDEX "MembreMergeLog_associationId_idx" ON "MembreMergeLog"("associationId");

-- CreateIndex
CREATE INDEX "MembreMergeLog_primaryMembreId_idx" ON "MembreMergeLog"("primaryMembreId");

-- CreateIndex
CREATE INDEX "Membre_associationId_mergedIntoId_idx" ON "Membre"("associationId", "mergedIntoId");

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreDuplicateMatch" ADD CONSTRAINT "MembreDuplicateMatch_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreDuplicateMatch" ADD CONSTRAINT "MembreDuplicateMatch_membreAId_fkey" FOREIGN KEY ("membreAId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreDuplicateMatch" ADD CONSTRAINT "MembreDuplicateMatch_membreBId_fkey" FOREIGN KEY ("membreBId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreDuplicateMatch" ADD CONSTRAINT "MembreDuplicateMatch_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreMergeLog" ADD CONSTRAINT "MembreMergeLog_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreMergeLog" ADD CONSTRAINT "MembreMergeLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

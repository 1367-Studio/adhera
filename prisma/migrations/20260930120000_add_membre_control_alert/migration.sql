-- CreateEnum
CREATE TYPE "MembreControlAlertStatus" AS ENUM ('OUVERT', 'RESOLU');

-- CreateTable
CREATE TABLE "MembreControlAlert" (
    "id" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "status" "MembreControlAlertStatus" NOT NULL DEFAULT 'OUVERT',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembreControlAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembreControlAlert_membreId_key" ON "MembreControlAlert"("membreId");

-- CreateIndex
CREATE INDEX "MembreControlAlert_status_raisedAt_idx" ON "MembreControlAlert"("status", "raisedAt");

-- CreateIndex
CREATE INDEX "MembreControlAlert_associationId_idx" ON "MembreControlAlert"("associationId");

-- AddForeignKey
ALTER TABLE "MembreControlAlert" ADD CONSTRAINT "MembreControlAlert_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreControlAlert" ADD CONSTRAINT "MembreControlAlert_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreControlAlert" ADD CONSTRAINT "MembreControlAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

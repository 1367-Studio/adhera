-- CreateTable
CREATE TABLE "MembreLog" (
    "id" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembreLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembreLog_membreId_createdAt_idx" ON "MembreLog"("membreId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "MembreLog" ADD CONSTRAINT "MembreLog_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembreLog" ADD CONSTRAINT "MembreLog_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

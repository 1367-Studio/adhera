-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3),
ADD COLUMN     "reviewToken" TEXT;

-- CreateTable
CREATE TABLE "EvenementAvis" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvenementAvis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvenementAvis_participationId_key" ON "EvenementAvis"("participationId");

-- CreateIndex
CREATE INDEX "EvenementAvis_evenementId_idx" ON "EvenementAvis"("evenementId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_reviewToken_key" ON "Participation"("reviewToken");

-- AddForeignKey
ALTER TABLE "EvenementAvis" ADD CONSTRAINT "EvenementAvis_evenementId_fkey" FOREIGN KEY ("evenementId") REFERENCES "Evenement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementAvis" ADD CONSTRAINT "EvenementAvis_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


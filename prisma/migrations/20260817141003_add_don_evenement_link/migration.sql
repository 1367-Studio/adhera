-- AlterTable
ALTER TABLE "Don" ADD COLUMN     "evenementId" TEXT;

-- CreateIndex
CREATE INDEX "Don_evenementId_idx" ON "Don"("evenementId");

-- AddForeignKey
ALTER TABLE "Don" ADD CONSTRAINT "Don_evenementId_fkey" FOREIGN KEY ("evenementId") REFERENCES "Evenement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

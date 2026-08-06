-- AlterTable
ALTER TABLE "Participation" ADD COLUMN "cancelToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Participation_cancelToken_key" ON "Participation"("cancelToken");

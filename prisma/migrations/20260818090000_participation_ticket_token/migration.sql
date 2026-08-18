-- AlterTable
ALTER TABLE "Participation" ADD COLUMN "ticketToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Participation_ticketToken_key" ON "Participation"("ticketToken");

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "stripeSessionId" TEXT,
ADD COLUMN     "ticketPaidAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Participation_stripeSessionId_key" ON "Participation"("stripeSessionId");

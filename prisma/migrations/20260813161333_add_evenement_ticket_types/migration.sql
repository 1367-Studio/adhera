-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "ticketTypeId" TEXT;

-- CreateTable
CREATE TABLE "EvenementTicketType" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "EvenementTicketType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvenementTicketType_evenementId_idx" ON "EvenementTicketType"("evenementId");

-- AddForeignKey
ALTER TABLE "EvenementTicketType" ADD CONSTRAINT "EvenementTicketType_evenementId_fkey" FOREIGN KEY ("evenementId") REFERENCES "Evenement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "EvenementTicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

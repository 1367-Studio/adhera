CREATE TYPE "EvenementTicketTypeItemType" AS ENUM ('TICKET', 'DONATION');

ALTER TABLE "EvenementTicketType" ADD COLUMN "itemType" "EvenementTicketTypeItemType" NOT NULL DEFAULT 'TICKET';

ALTER TABLE "Don" ADD COLUMN "evenementTicketTypeId" TEXT;

CREATE INDEX "Don_evenementTicketTypeId_idx" ON "Don"("evenementTicketTypeId");

ALTER TABLE "Don" ADD CONSTRAINT "Don_evenementTicketTypeId_fkey" FOREIGN KEY ("evenementTicketTypeId") REFERENCES "EvenementTicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

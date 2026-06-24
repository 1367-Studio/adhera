-- AlterTable
ALTER TABLE "Actualite" ADD COLUMN     "recipientMode" TEXT NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE "ActualiteRecipient" (
    "actualiteId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,

    CONSTRAINT "ActualiteRecipient_pkey" PRIMARY KEY ("actualiteId","membreId")
);

-- AddForeignKey
ALTER TABLE "ActualiteRecipient" ADD CONSTRAINT "ActualiteRecipient_actualiteId_fkey" FOREIGN KEY ("actualiteId") REFERENCES "Actualite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActualiteRecipient" ADD CONSTRAINT "ActualiteRecipient_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

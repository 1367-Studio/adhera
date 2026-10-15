-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "donResponsableId" TEXT;

-- AddForeignKey
ALTER TABLE "Association" ADD CONSTRAINT "Association_donResponsableId_fkey" FOREIGN KEY ("donResponsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

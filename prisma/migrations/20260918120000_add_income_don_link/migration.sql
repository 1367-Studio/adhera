-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "donId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Income_donId_key" ON "Income"("donId");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_donId_fkey" FOREIGN KEY ("donId") REFERENCES "Don"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ChartAccount" ADD COLUMN     "bankAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChartAccount_bankAccountId_key" ON "ChartAccount"("bankAccountId");

-- AddForeignKey
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

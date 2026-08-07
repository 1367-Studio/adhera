-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "factureRecueId" TEXT;

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "facturePaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_factureRecueId_key" ON "Expense"("factureRecueId");

-- CreateIndex
CREATE UNIQUE INDEX "Income_facturePaymentId_key" ON "Income"("facturePaymentId");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_facturePaymentId_fkey" FOREIGN KEY ("facturePaymentId") REFERENCES "FacturePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_factureRecueId_fkey" FOREIGN KEY ("factureRecueId") REFERENCES "FactureRecue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

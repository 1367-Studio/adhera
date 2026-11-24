-- AlterTable
ALTER TABLE "FactureRecue" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "factureRecueId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_factureRecueId_key" ON "Expense"("factureRecueId");

-- AddForeignKey
ALTER TABLE "FactureRecue" ADD CONSTRAINT "FactureRecue_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_factureRecueId_fkey" FOREIGN KEY ("factureRecueId") REFERENCES "FactureRecue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

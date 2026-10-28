-- CreateTable
CREATE TABLE "BudgetProject" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetProject_associationId_archivedAt_idx" ON "BudgetProject"("associationId", "archivedAt");

-- AddForeignKey
ALTER TABLE "BudgetProject" ADD CONSTRAINT "BudgetProject_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "exerciceId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "projectId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetLine_associationId_exerciceId_idx" ON "BudgetLine"("associationId", "exerciceId");

-- CreateIndex
CREATE INDEX "BudgetLine_exerciceId_projectId_idx" ON "BudgetLine"("exerciceId", "projectId");

-- Two partial unique indexes instead of one plain @@unique([exerciceId, categoryId, projectId]):
-- Postgres treats NULL as distinct in a regular unique index, so a plain unique constraint
-- would let two "sans projet" (projectId IS NULL) rows coexist for the same category/exercice,
-- which the feature explicitly forbids (there is only ever one "sans projet" forecast per
-- category per exercice).
-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_exercice_category_project_key" ON "BudgetLine"("exerciceId", "categoryId", "projectId") WHERE "projectId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_exercice_category_no_project_key" ON "BudgetLine"("exerciceId", "categoryId") WHERE "projectId" IS NULL;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceComptable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BudgetProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Income" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Income_associationId_projectId_idx" ON "Income"("associationId", "projectId");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BudgetProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_associationId_projectId_idx" ON "Expense"("associationId", "projectId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BudgetProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

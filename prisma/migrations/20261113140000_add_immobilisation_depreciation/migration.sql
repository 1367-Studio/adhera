-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('LINEAIRE');

-- CreateTable
CREATE TABLE "Immobilisation" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "assetAccountCode" TEXT NOT NULL,
    "depreciationAccountCode" TEXT NOT NULL,
    "expenseAccountCode" TEXT NOT NULL,
    "entryValue" DECIMAL(10,2) NOT NULL,
    "residualValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "usageStartDate" TIMESTAMP(3) NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'LINEAIRE',
    "disposalDate" TIMESTAMP(3),
    "expenseId" TEXT,
    "factureRecueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Immobilisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImmobilisationDepreciation" (
    "id" TEXT NOT NULL,
    "immobilisationId" TEXT NOT NULL,
    "exerciceId" TEXT NOT NULL,
    "dotationAmount" DECIMAL(10,2) NOT NULL,
    "accumulatedAfter" DECIMAL(10,2) NOT NULL,
    "netValueAfter" DECIMAL(10,2) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImmobilisationDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Immobilisation_expenseId_key" ON "Immobilisation"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "Immobilisation_factureRecueId_key" ON "Immobilisation"("factureRecueId");

-- CreateIndex
CREATE INDEX "Immobilisation_associationId_idx" ON "Immobilisation"("associationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImmobilisationDepreciation_journalEntryId_key" ON "ImmobilisationDepreciation"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ImmobilisationDepreciation_immobilisationId_exerciceId_key" ON "ImmobilisationDepreciation"("immobilisationId", "exerciceId");

-- AddForeignKey
ALTER TABLE "Immobilisation" ADD CONSTRAINT "Immobilisation_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Immobilisation" ADD CONSTRAINT "Immobilisation_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Immobilisation" ADD CONSTRAINT "Immobilisation_factureRecueId_fkey" FOREIGN KEY ("factureRecueId") REFERENCES "FactureRecue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmobilisationDepreciation" ADD CONSTRAINT "ImmobilisationDepreciation_immobilisationId_fkey" FOREIGN KEY ("immobilisationId") REFERENCES "Immobilisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmobilisationDepreciation" ADD CONSTRAINT "ImmobilisationDepreciation_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceComptable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmobilisationDepreciation" ADD CONSTRAINT "ImmobilisationDepreciation_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


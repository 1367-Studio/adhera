-- CreateEnum
CREATE TYPE "ExerciceStatus" AS ENUM ('OUVERT', 'CLOTURE');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "exerciceId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "exerciceId" TEXT;

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "exerciceId" TEXT;

-- CreateTable
CREATE TABLE "ExerciceComptable" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "ExerciceStatus" NOT NULL DEFAULT 'OUVERT',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciceComptable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExerciceComptable_associationId_status_idx" ON "ExerciceComptable"("associationId", "status");

-- CreateIndex
CREATE INDEX "ExerciceComptable_associationId_startDate_idx" ON "ExerciceComptable"("associationId", "startDate");

-- AddForeignKey
ALTER TABLE "ExerciceComptable" ADD CONSTRAINT "ExerciceComptable_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceComptable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceComptable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceComptable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

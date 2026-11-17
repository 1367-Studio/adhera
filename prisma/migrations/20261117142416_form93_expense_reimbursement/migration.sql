-- CreateEnum
CREATE TYPE "AccountingRegime" AS ENUM ('ACCRUAL', 'CASH');

-- CreateEnum
CREATE TYPE "ReimbursementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'NEEDS_CORRECTION', 'APPROVED', 'REJECTED', 'REIMBURSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'REIMBURSEMENT_SETTLEMENT';

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "accountingRegime" "AccountingRegime" NOT NULL DEFAULT 'CASH';

-- AlterTable
ALTER TABLE "BankReconciliation" ADD COLUMN     "reimbursementRequestId" TEXT;

-- AlterTable
ALTER TABLE "ChartAccount" ADD COLUMN     "reimbursementPayeeUserId" TEXT;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "reimbursementRequestId" TEXT;

-- CreateTable
CREATE TABLE "ReimbursementRequest" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "comment" TEXT,
    "projectId" TEXT,
    "status" "ReimbursementStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "correctionComment" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementItem" (
    "id" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "receiptUrl" TEXT NOT NULL,
    "receiptFileName" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "reference" TEXT,
    "registeredByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReimbursementRequest_associationId_status_idx" ON "ReimbursementRequest"("associationId", "status");

-- CreateIndex
CREATE INDEX "ReimbursementRequest_associationId_requesterId_idx" ON "ReimbursementRequest"("associationId", "requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "ReimbursementItem_expenseId_key" ON "ReimbursementItem"("expenseId");

-- CreateIndex
CREATE INDEX "ReimbursementItem_reimbursementRequestId_idx" ON "ReimbursementItem"("reimbursementRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Reimbursement_reimbursementRequestId_key" ON "Reimbursement"("reimbursementRequestId");

-- CreateIndex
CREATE INDEX "Reimbursement_associationId_idx" ON "Reimbursement"("associationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_reimbursementRequestId_key" ON "BankReconciliation"("reimbursementRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ChartAccount_reimbursementPayeeUserId_key" ON "ChartAccount"("reimbursementPayeeUserId");

-- CreateIndex
CREATE INDEX "JournalEntry_reimbursementRequestId_idx" ON "JournalEntry"("reimbursementRequestId");

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BudgetProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementItem" ADD CONSTRAINT "ReimbursementItem_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementItem" ADD CONSTRAINT "ReimbursementItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReimbursementItem" ADD CONSTRAINT "ReimbursementItem_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_reimbursementPayeeUserId_fkey" FOREIGN KEY ("reimbursementPayeeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;


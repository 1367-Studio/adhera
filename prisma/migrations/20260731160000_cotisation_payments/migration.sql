-- AlterEnum
ALTER TYPE "CotisationStatus" ADD VALUE 'PARTIELLEMENT_PAYEE';

-- AlterTable
ALTER TABLE "Cotisation" ADD COLUMN     "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "lastReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "cotisationPaymentId" TEXT;

-- CreateTable
CREATE TABLE "CotisationPayment" (
    "id" TEXT NOT NULL,
    "cotisationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotisationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CotisationPayment_cotisationId_paidAt_idx" ON "CotisationPayment"("cotisationId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Income_cotisationPaymentId_key" ON "Income"("cotisationPaymentId");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_cotisationPaymentId_fkey" FOREIGN KEY ("cotisationPaymentId") REFERENCES "CotisationPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotisationPayment" ADD CONSTRAINT "CotisationPayment_cotisationId_fkey" FOREIGN KEY ("cotisationId") REFERENCES "Cotisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CotisationInstallment" (
    "id" TEXT NOT NULL,
    "cotisationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CotisationInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CotisationInstallment_cotisationId_idx" ON "CotisationInstallment"("cotisationId");

-- AddForeignKey
ALTER TABLE "CotisationInstallment" ADD CONSTRAINT "CotisationInstallment_cotisationId_fkey" FOREIGN KEY ("cotisationId") REFERENCES "Cotisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase 6 do pedido do Leandro: código promocional de desconto por tarifa (a mais arriscada,
-- feita por último). Additive-only: novo enum, nova tabela, e uma coluna nullable em
-- Participation com FK ON DELETE SET NULL (apagar um código não deve apagar a inscrição).

-- CreateEnum
CREATE TYPE "EvenementDiscountKind" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "EvenementDiscountCode" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "EvenementDiscountKind" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ticketTypeIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvenementDiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvenementDiscountCode_evenementId_idx" ON "EvenementDiscountCode"("evenementId");

-- CreateIndex
CREATE UNIQUE INDEX "EvenementDiscountCode_evenementId_code_key" ON "EvenementDiscountCode"("evenementId", "code");

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN "discountCodeId" TEXT;

-- AddForeignKey
ALTER TABLE "EvenementDiscountCode" ADD CONSTRAINT "EvenementDiscountCode_evenementId_fkey" FOREIGN KEY ("evenementId") REFERENCES "Evenement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "EvenementDiscountCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

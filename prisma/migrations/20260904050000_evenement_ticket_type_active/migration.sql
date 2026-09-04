-- Fase 2 do pedido do Leandro: ativar/desativar uma tarifa sem apagar (mantém histórico).
-- Backfill a true: toda tarifa existente já era "ativa" implicitamente, comportamento idêntico.

-- AlterTable
ALTER TABLE "EvenementTicketType" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

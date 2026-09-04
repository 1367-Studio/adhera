-- Fase 3 do pedido do Leandro: período de validade (janela de venda) por tarifa individual.
-- Additive-only, colunas nullable — null = sempre aberta, comportamento idêntico a antes.

-- AlterTable
ALTER TABLE "EvenementTicketType" ADD COLUMN "opensAt" TIMESTAMP(3),
ADD COLUMN "closesAt" TIMESTAMP(3);

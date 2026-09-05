-- Fase 5 do pedido do Leandro: lista de espera quando o evento (ou uma tarifa) lotar.
-- Additive-only: novo valor de enum + um boolean opt-in, backfill false = comportamento
-- idêntico a antes (bloqueio duro na capacidade, como já era).

-- AlterEnum
ALTER TYPE "RsvpStatus" ADD VALUE 'LISTA_ESPERA';

-- AlterTable
ALTER TABLE "Evenement" ADD COLUMN "waitlistEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Fase 1 do pedido do Leandro: mais tipos de campo personalizado nos Eventos.
-- Additive-only: novos valores de enum + uma coluna nullable, sem backfill necessário.

-- AlterEnum
ALTER TYPE "EvenementFieldType" ADD VALUE 'LONG_TEXT';
ALTER TYPE "EvenementFieldType" ADD VALUE 'DATE';
ALTER TYPE "EvenementFieldType" ADD VALUE 'SELECT';
ALTER TYPE "EvenementFieldType" ADD VALUE 'RADIO';
ALTER TYPE "EvenementFieldType" ADD VALUE 'CHECKBOX_MULTI';
ALTER TYPE "EvenementFieldType" ADD VALUE 'BOOLEAN';

-- AlterTable
ALTER TABLE "EvenementCustomField" ADD COLUMN "options" JSONB;

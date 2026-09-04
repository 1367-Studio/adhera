-- Fase 4 of the Eventos/AssoConnect parity plan: lets an admin add a "file upload" custom
-- field to an event's public registration form. Additive-only (new enum value), no backfill.

-- AlterEnum
ALTER TYPE "EvenementFieldType" ADD VALUE 'FILE';

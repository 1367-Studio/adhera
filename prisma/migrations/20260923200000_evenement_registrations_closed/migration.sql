-- Fermeture manuelle des inscriptions en ligne d'un événement par le gestionnaire
-- (null = ouvertes, comportement identique à avant pour toute ligne existante).
-- Additif, aucune donnée touchée.

-- AlterTable
ALTER TABLE "Evenement" ADD COLUMN "registrationsClosedAt" TIMESTAMP(3);

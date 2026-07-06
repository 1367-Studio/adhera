-- A member can bring guests (extra rows with membreId null), but must not hold two
-- "self" tickets for the same event. Prisma's schema-level @@unique can't express a
-- partial index, so it's added here directly.
CREATE UNIQUE INDEX participation_membre_self_unique
  ON "Participation" ("membreId", "evenementId") WHERE "membreId" IS NOT NULL;

-- Closes a TOCTOU race in POST /api/erasure-requests: the `findFirst` check for an existing
-- active request and the following `create` are two separate statements, so a double-click or
-- two admins acting on the same membre at once could both pass the check and create two active
-- ErasureRequest rows. Prisma's schema can't express a partial index, so this is hand-written
-- and not mirrored in schema.prisma — see the comment on the ErasureRequest model.
--
-- Only one row per membre may sit in REVIEW/PENDING/HELD at a time; PROCESSED rows are exempt
-- since they're kept as permanent history and a membre can accumulate several over time.
CREATE UNIQUE INDEX "ErasureRequest_membreId_active_unique"
    ON "ErasureRequest"("membreId")
    WHERE "status" IN ('REVIEW', 'PENDING', 'HELD');

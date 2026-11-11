-- The plain @@unique([associationId, key]) added in 20261029130000 applied even to archived
-- rows, which meant archiving a keyed default category had to NULL its key to free the slot
-- for a replacement — and reactivating the original row afterward had no way to restore it,
-- leaving it permanently keyless (unreachable by getOrCreateDefaultCategory/
-- resolveIncomeCategory, so future transactions of that type silently fall through to "à
-- catégoriser" instead of it). Replaced with a partial index, matching the name-uniqueness
-- index's own pattern: an archived row's key no longer blocks anything, reactivating it
-- re-claims the key cleanly (or 409s if a replacement was created meanwhile — see the PATCH
-- route's existing P2002 handling), and DELETE no longer needs to touch `key` at all.

-- DropIndex
DROP INDEX "FinanceCategory_associationId_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCategory_associationId_key_key" ON "FinanceCategory"("associationId", "key") WHERE "archivedAt" IS NULL;

-- Apply AFTER scripts/merge-duplicate-finance-categories.ts has deduplicated any existing
-- (associationId, key) or (associationId, type, lower(name)) collision — see the previous
-- migration's note. This one fails outright if the data isn't clean yet.

-- CreateIndex
-- Postgres allows multiple NULLs in a unique index, so custom categories (key IS NULL) are
-- unaffected — only two rows sharing the same non-null key for one association are rejected.
CREATE UNIQUE INDEX "FinanceCategory_associationId_key_key" ON "FinanceCategory"("associationId", "key");

-- CreateIndex
-- Blocks two ACTIVE categories of the same type with the same name (case-insensitive) for one
-- association — the real duplicate the task asks to prevent. Partial (WHERE archivedAt IS
-- NULL) so an archived category never blocks a new one from reusing its name.
CREATE UNIQUE INDEX "FinanceCategory_assoc_type_name_unique" ON "FinanceCategory"("associationId", "type", lower("name")) WHERE "archivedAt" IS NULL;

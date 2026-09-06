-- Evenement.slug: readable public URL segment, unique per association (see Evenement in
-- prisma/schema.prisma and src/lib/slug.ts). Nullable — code older than this column may still
-- insert events without one during a deploy, and every link builder falls back to the id — but
-- backfilled here for every existing event so their links are readable right away, with the
-- same transformation as toSlug() in src/lib/slug.ts (lower-case, accents stripped, runs of
-- non [a-z0-9] collapsed to "-").

-- AlterTable
ALTER TABLE "Evenement" ADD COLUMN     "slug" TEXT;

-- Backfill. Duplicate titles inside one association get a numeric suffix in creation order
-- ("gala", "gala-1", "gala-2"), matching what generateEvenementSlug() would have produced.
WITH base AS (
  SELECT
    id,
    "associationId",
    "createdAt",
    COALESCE(
      NULLIF(
        trim(BOTH '-' FROM regexp_replace(
          translate(lower(title), 'àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿœ', 'aaaaaaaceeeeiiiinoooooouuuuyyo'),
          '[^a-z0-9]+', '-', 'g'
        )),
        ''
      ),
      'evenement'
    ) AS s
  FROM "Evenement"
),
ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY "associationId", s ORDER BY "createdAt", id) AS rn
  FROM base
)
UPDATE "Evenement" e
SET "slug" = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || (r.rn - 1) END
FROM ranked r
WHERE e.id = r.id;

-- A numeric suffix can in theory land on a slug another title already produced ("gala" twice
-- next to a title "Gala 1"); resolve any such leftover with a short id suffix so the unique
-- index below can never fail.
WITH dup AS (
  SELECT id, row_number() OVER (PARTITION BY "associationId", "slug" ORDER BY "createdAt", id) AS rn
  FROM "Evenement"
)
UPDATE "Evenement" e
SET "slug" = e."slug" || '-' || left(e.id, 6)
FROM dup
WHERE e.id = dup.id AND dup.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "Evenement_associationId_slug_key" ON "Evenement"("associationId", "slug");

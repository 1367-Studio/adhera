import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { NO_CATEGORY_FILTER } from "@/lib/cotisation-filters"

// Shared between GET /api/cotisations (list + summary), /api/cotisations/distribution and
// /api/cotisations/export — every consumer must parse and apply filters identically, or the
// table, the compact indicators, "Voir la répartition" and the Excel export could show
// inconsistent numbers for the same filter combination.

export type RenewalMode = "AUTO" | "MANUAL"

export type CotisationFilters = {
  year?:        number
  status?:      string // comma-separated, same convention as the pre-existing status filter
  search?:      string
  tierId?:      string
  renewalMode?: RenewalMode
}

export function parseCotisationFilters(searchParams: URLSearchParams): CotisationFilters {
  const year          = searchParams.get("year")
  const status        = searchParams.get("status") ?? undefined
  const search        = searchParams.get("search")?.trim() || undefined
  const tierId        = searchParams.get("tierId")?.trim() || undefined
  const renewalModeRaw = searchParams.get("renewalMode")
  const renewalMode: RenewalMode | undefined =
    renewalModeRaw === "AUTO" || renewalModeRaw === "MANUAL" ? renewalModeRaw : undefined

  return {
    year: year ? parseInt(year) : undefined,
    status,
    search,
    tierId,
    renewalMode,
  }
}

// Typed Prisma `where`, for findMany/count — used by the paginated list and by the export's
// detail sheet (both need the full Cotisation row with its relations, which raw SQL can't
// give back as conveniently as Prisma's own query builder + `include`).
export function buildCotisationWhere(associationId: string, filters: CotisationFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { associationId, membre: { deletedAt: null } }
  if (filters.year)   where.year   = filters.year
  if (filters.status) where.status = filters.status.includes(",") ? { in: filters.status.split(",") } : filters.status
  if (filters.tierId) where.tierId = filters.tierId === NO_CATEGORY_FILTER ? null : filters.tierId
  if (filters.renewalMode) where.subscriptionId = filters.renewalMode === "AUTO" ? { not: null } : null
  if (filters.search) {
    where.membre = {
      deletedAt: null,
      OR: [
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName:  { contains: filters.search, mode: "insensitive" } },
      ],
    }
  }
  return where
}

// Same filters as a raw-SQL WHERE fragment (no leading "WHERE"), for the money aggregates that
// need CASE/GROUP BY which Prisma's query builder can't express. Assumes the caller's query
// aliases Cotisation as `c` and joins Membre as `m` (m.id = c."membreId" AND m."deletedAt" IS
// NULL) — both the summary aggregate and the distribution breakdown do this.
export function buildCotisationSqlFilter(associationId: string, filters: CotisationFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`c."associationId" = ${associationId}`]

  if (filters.year) conditions.push(Prisma.sql`c."year" = ${filters.year}`)

  if (filters.status) {
    const statuses = filters.status.split(",")
    conditions.push(Prisma.sql`c."status" IN (${Prisma.join(statuses.map(s => Prisma.sql`${s}::"CotisationStatus"`))})`)
  }

  if (filters.tierId === NO_CATEGORY_FILTER) conditions.push(Prisma.sql`c."tierId" IS NULL`)
  else if (filters.tierId)                   conditions.push(Prisma.sql`c."tierId" = ${filters.tierId}`)
  if (filters.renewalMode === "AUTO")   conditions.push(Prisma.sql`c."subscriptionId" IS NOT NULL`)
  if (filters.renewalMode === "MANUAL") conditions.push(Prisma.sql`c."subscriptionId" IS NULL`)

  if (filters.search) {
    const like = `%${filters.search}%`
    conditions.push(Prisma.sql`(m."firstName" ILIKE ${like} OR m."lastName" ILIKE ${like})`)
  }

  return Prisma.join(conditions, " AND ")
}

// Per-row money formulas, reused verbatim by the summary aggregate and the distribution
// breakdown so the two can never drift apart:
// - EXONERE/ANNULEE owe nothing ("après... isenções" / cancelled never inflates what's due).
// - An exemption is never a receipt (EXONERE always carries amountPaid = 0 — enforced by
//   reverseCotisationPayments when a cotisation is set EXONERE, see PATCH /api/cotisations/[id]).
// - A cancelled cotisation's already-received money still counts as received — confirmed with
//   the association: "se recebeu dinheiro ele nao pode ficar avulso" (received money can't be
//   left dangling/unaccounted for just because the cotisation was later cancelled).
export const A_PAGAR_SQL  = Prisma.sql`CASE WHEN c."status" IN ('EXONERE', 'ANNULEE') THEN 0 ELSE c."amount" END`
export const RECEBIDO_SQL = Prisma.sql`c."amountPaid"`
export const SALDO_SQL    = Prisma.sql`CASE WHEN c."status" IN ('EXONERE', 'ANNULEE') THEN 0 ELSE GREATEST(c."amount" - c."amountPaid", 0) END`

export type DistributionGroup = {
  tierId:      string | null
  tierLabel:   string | null
  renewalMode: RenewalMode
  count:       number
  aPagar:      number
  recebido:    number
  saldo:       number
}

type DistributionRow = {
  tierId:    string | null
  tierLabel: string | null
  isAuto:    boolean
  count:     bigint
  aPagar:    string | null
  recebido:  string | null
  saldo:     string | null
}

// Single source for the catégorie×renouvellement breakdown — used by both
// /api/cotisations/distribution ("Voir la répartition") and /api/cotisations/export (its
// "Répartition" sheet), so the two can never show different numbers for the same filters.
export async function computeCotisationDistribution(associationId: string, filters: CotisationFilters) {
  const sqlFilter = buildCotisationSqlFilter(associationId, filters)

  const rows = await prisma.$queryRaw<DistributionRow[]>(Prisma.sql`
    SELECT
      c."tierId"                       AS "tierId",
      t."label"                        AS "tierLabel",
      (c."subscriptionId" IS NOT NULL) AS "isAuto",
      COUNT(*)                         AS count,
      COALESCE(SUM(${A_PAGAR_SQL}), 0)  AS "aPagar",
      COALESCE(SUM(${RECEBIDO_SQL}), 0) AS "recebido",
      COALESCE(SUM(${SALDO_SQL}), 0)    AS "saldo"
    FROM "Cotisation" c
    JOIN "Membre" m ON m.id = c."membreId" AND m."deletedAt" IS NULL
    LEFT JOIN "MembershipTier" t ON t.id = c."tierId"
    WHERE ${sqlFilter}
    GROUP BY c."tierId", t."label", (c."subscriptionId" IS NOT NULL)
    ORDER BY t."label" ASC NULLS LAST, "isAuto" DESC
  `)

  const groups: DistributionGroup[] = rows.map(r => ({
    tierId:      r.tierId,
    tierLabel:   r.tierLabel,
    renewalMode: r.isAuto ? "AUTO" : "MANUAL",
    count:       Number(r.count),
    aPagar:      Number(r.aPagar ?? 0),
    recebido:    Number(r.recebido ?? 0),
    saldo:       Number(r.saldo ?? 0),
  }))

  const total = groups.reduce((acc, g) => ({
    count:    acc.count + g.count,
    aPagar:   acc.aPagar + g.aPagar,
    recebido: acc.recebido + g.recebido,
    saldo:    acc.saldo + g.saldo,
  }), { count: 0, aPagar: 0, recebido: 0, saldo: 0 })

  return { groups, total }
}

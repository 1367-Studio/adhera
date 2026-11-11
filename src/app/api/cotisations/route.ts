import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { cotisationSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { deriveCotisationStatus } from "@/lib/cotisation-status"
import { parseCotisationFilters, buildCotisationWhere, buildCotisationSqlFilter, A_PAGAR_SQL, RECEBIDO_SQL, SALDO_SQL } from "@/lib/cotisation-query"

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const filters = parseCotisationFilters(searchParams)
  const where   = buildCotisationWhere(associationId, filters)

  const include = {
    membre:       { select: { id: true, firstName: true, lastName: true, email: true } },
    payments:     { orderBy: { paidAt: "desc" as const } },
    installments: { orderBy: { order: "asc" as const } },
  }
  const orderBy = [
    { membre: { lastName: "asc" as const } },
    { year:   "desc" as const },
  ]

  if (!searchParams.has("page")) {
    const data = await prisma.cotisation.findMany({ where, include, orderBy, take: 500 })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const sqlFilter = buildCotisationSqlFilter(associationId, filters)

  // Indicators must reflect every filtered row, not just the current page — a plain Prisma
  // `aggregate` can't express the conditional (EXONERE/ANNULEE-aware) sums below, hence the
  // raw query. Shares its WHERE and per-row formulas with /api/cotisations/distribution and
  // /api/cotisations/export so the table, indicators, breakdown and export can never diverge.
  const [data, total, summaryRows] = await Promise.all([
    prisma.cotisation.findMany({ where, include, orderBy, skip, take: limit }),
    prisma.cotisation.count({ where }),
    prisma.$queryRaw<{ count: bigint; aPagar: string | null; recebido: string | null; saldo: string | null }[]>(Prisma.sql`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(${A_PAGAR_SQL}), 0)  AS "aPagar",
        COALESCE(SUM(${RECEBIDO_SQL}), 0) AS "recebido",
        COALESCE(SUM(${SALDO_SQL}), 0)    AS "saldo"
      FROM "Cotisation" c
      JOIN "Membre" m ON m.id = c."membreId" AND m."deletedAt" IS NULL
      WHERE ${sqlFilter}
    `),
  ])
  const summaryRow = summaryRows[0]
  const summary = {
    count:    Number(summaryRow?.count ?? 0),
    aPagar:   Number(summaryRow?.aPagar ?? 0),
    recebido: Number(summaryRow?.recebido ?? 0),
    saldo:    Number(summaryRow?.saldo ?? 0),
  }

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit), summary })
}, { area: "adhesions" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json()
  const parsed = cotisationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // One row per (membre, year) — unconditional at the DB level (@@unique in schema.prisma),
  // regardless of status. A cancelled cotisation still occupies its year, so this check (and
  // the client-side handling of it) must account for that instead of just reporting "already
  // exists": the fix is to edit that existing row back to life, not to create a second one.
  const existing = await prisma.cotisation.findUnique({
    where: { membreId_year: { membreId: parsed.data.membreId, year: parsed.data.year } },
  })
  if (existing) {
    return NextResponse.json(
      existing.status === "ANNULEE"
        ? { error: `Une cotisation ${parsed.data.year} annulée existe déjà pour ce membre — modifiez-la plutôt que d'en créer une nouvelle.`, code: "CANCELLED_EXISTS", cotisationId: existing.id }
        : { error: `Une cotisation pour ${parsed.data.year} existe déjà pour ce membre.` },
      { status: 409 },
    )
  }

  const { dueDate, note, amount, installments, status, ...rest } = parsed.data

  // A cotisation is always created pending (or EXONERE/ANNULEE if explicitly requested) —
  // paying happens afterward through the dedicated payment endpoint, never in one step at
  // create time (matches how Facture works — see facture-form.tsx). Still resolves the
  // *initial* automatic status via deriveCotisationStatus so a cotisation created with a
  // due date already in the past correctly starts as EN_RETARD instead of EN_ATTENTE.
  const resolvedStatus = deriveCotisationStatus({
    currentStatus: status ?? "EN_ATTENTE",
    amount,
    amountPaid:    0,
    dueDate:       dueDate ? new Date(dueDate) : null,
    installments:  installments?.map((i, order) => ({ amount: i.amount, dueDate: new Date(i.dueDate), order })),
  })

  const cotisation = await prisma.cotisation.create({
    data: {
      ...rest,
      associationId,
      amount,
      status:  resolvedStatus,
      dueDate: dueDate ? new Date(dueDate) : null,
      note:    note || null,
      ...(installments && installments.length > 0 ? {
        installments: { create: installments.map((i, order) => ({ amount: i.amount, dueDate: new Date(i.dueDate), order })) },
      } : {}),
    },
    include: {
      membre:       { select: { id: true, firstName: true, lastName: true, email: true } },
      payments:     { orderBy: { paidAt: "desc" } },
      installments: { orderBy: { order: "asc" } },
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "COTISATION_CREATED", entity: "Cotisation", entityId: cotisation.id, label: `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}` })
  return NextResponse.json(cotisation, { status: 201 })
}, { area: "adhesions", module: "cotisations" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { cotisationSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { deriveCotisationStatus } from "@/lib/cotisation-status"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const year   = searchParams.get("year")
  const status = searchParams.get("status") ?? undefined
  const search = searchParams.get("search")?.trim()

  const where: Record<string, unknown> = { associationId, membre: { deletedAt: null } }
  if (year)   where.year   = parseInt(year)
  // Comma-separated accepts multiple statuses (e.g. "select all matching" for reminders,
  // which targets EN_ATTENTE/PARTIELLEMENT_PAYEE/EN_RETARD) — single value stays a plain
  // equality match for the status-filter dropdown's normal usage.
  if (status) where.status = status.includes(",") ? { in: status.split(",") } : status
  if (search) {
    where.membre = {
      deletedAt: null,
      OR: [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName:  { contains: search, mode: "insensitive" } },
      ],
    }
  }

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
  const [data, total, aggregate] = await Promise.all([
    prisma.cotisation.findMany({ where, include, orderBy, skip, take: limit }),
    prisma.cotisation.count({ where }),
    prisma.cotisation.aggregate({ where: { ...where, status: "PAYE" }, _sum: { amount: true } }),
  ])
  const totalPaye = Number(aggregate._sum.amount ?? 0)
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit), totalPaye })
})

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json()
  const parsed = cotisationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const existing = await prisma.cotisation.findUnique({
    where: { membreId_year: { membreId: parsed.data.membreId, year: parsed.data.year } },
  })
  if (existing) {
    return NextResponse.json(
      { error: `Une cotisation pour ${parsed.data.year} existe déjà pour ce membre.` },
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
}, { roles: MANAGERS, module: "cotisations" })

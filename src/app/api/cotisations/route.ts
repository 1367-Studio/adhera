import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { cotisationSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const year   = searchParams.get("year")
  const status = searchParams.get("status") ?? undefined
  const search = searchParams.get("search")?.trim()

  const where: Record<string, unknown> = { associationId, membre: { deletedAt: null } }
  if (year)   where.year   = parseInt(year)
  if (status) where.status = status
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
    membre: { select: { id: true, firstName: true, lastName: true, email: true } },
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
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "cotisations")
  if (guard) return guard

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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

  const { paidAt, note, amount, ...rest } = parsed.data
  const cotisation = await prisma.cotisation.create({
    data: {
      ...rest,
      associationId,
      amount: amount,
      paidAt: paidAt ? new Date(paidAt) : null,
      note:   note   || null,
    },
    include: { membre: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })

  if (cotisation.status === "PAYE" && cotisation.amount != null) {
    await prisma.income.create({
      data: {
        associationId,
        memberId:    cotisation.membreId,
        amount:      cotisation.amount,
        description: `Cotisation ${cotisation.year} — ${cotisation.membre.firstName} ${cotisation.membre.lastName}`,
        source:      "MANUAL",
        status:      "PAID",
        date:        cotisation.paidAt ?? new Date(),
      },
    })
  }

  await writeActivityLog({ associationId, actorId: userId, action: "COTISATION_CREATED", entity: "Cotisation", entityId: cotisation.id, label: `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}` })
  return NextResponse.json(cotisation, { status: 201 })
}

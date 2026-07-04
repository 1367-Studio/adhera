import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { incomeSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const status     = searchParams.get("status")   ?? undefined
  const categoryId = searchParams.get("categoryId") ?? undefined
  const memberId   = searchParams.get("memberId")  ?? undefined
  const dateFrom   = searchParams.get("dateFrom")  ?? undefined
  const dateTo     = searchParams.get("dateTo")    ?? undefined

  const where: Record<string, unknown> = { associationId }
  if (status)     where.status     = status
  if (categoryId) where.categoryId = categoryId
  if (memberId)   where.memberId   = memberId
  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
    }
  }

  const include = {
    membre:   { select: { firstName: true, lastName: true } },
    category: { select: { name: true, type: true } },
    reconciliations: { select: { id: true } },
  }

  const orderBy = { date: "desc" as const }

  if (!searchParams.has("page")) {
    const data = await prisma.income.findMany({ where, orderBy, include })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.income.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.income.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: FINANCE, module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = incomeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, memberId, paymentMethod, description, reference, ...rest } = parsed.data
  const income = await prisma.income.create({
    data: {
      ...rest,
      associationId,
      date:          new Date(date),
      categoryId:    categoryId    || null,
      memberId:      memberId      || null,
      paymentMethod: paymentMethod || null,
      description:   description   || null,
      reference:     reference     || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "INCOME_CREATED", entity: "Income", entityId: income.id, label: description || `Recette ${Number(income.amount)}€`, metadata: { amount: Number(income.amount) } })
  return NextResponse.json(income, { status: 201 })
}, { roles: FINANCE, module: "finances" })

import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { expenseSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const guard = await guardModule(ctx.associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const status     = searchParams.get("status")     ?? undefined
  const categoryId = searchParams.get("categoryId") ?? undefined
  const vendor     = searchParams.get("vendor")     ?? undefined
  const dateFrom   = searchParams.get("dateFrom")   ?? undefined
  const dateTo     = searchParams.get("dateTo")     ?? undefined

  const where: Record<string, unknown> = { associationId }
  if (status)     where.status     = status
  if (categoryId) where.categoryId = categoryId
  if (vendor)     where.vendor     = { contains: vendor, mode: "insensitive" }
  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
    }
  }

  const include = {
    category:       { select: { name: true, type: true } },
    reconciliations: { select: { id: true } },
  }

  const orderBy = { date: "desc" as const }

  if (!searchParams.has("page")) {
    const data = await prisma.expense.findMany({ where, orderBy, include })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.expense.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.expense.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body   = await req.json()
  const parsed = expenseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, vendor, description, receiptUrl, internalNote, ...rest } = parsed.data
  const expense = await prisma.expense.create({
    data: {
      ...rest,
      associationId,
      date:         new Date(date),
      categoryId:   categoryId   || null,
      vendor:       vendor       || null,
      description:  description  || null,
      receiptUrl:   receiptUrl   || null,
      internalNote: internalNote || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "EXPENSE_CREATED", entity: "Expense", entityId: expense.id, label: description || vendor || `Dépense ${Number(expense.amount)}€`, metadata: { amount: Number(expense.amount) } })
  return NextResponse.json(expense, { status: 201 })
}

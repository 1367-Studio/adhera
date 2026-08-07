import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { expenseSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const status          = searchParams.get("status")     ?? undefined
  const categoryId      = searchParams.get("categoryId") ?? undefined
  const vendor          = searchParams.get("vendor")     ?? undefined
  const dateFrom        = searchParams.get("dateFrom")   ?? undefined
  const dateTo          = searchParams.get("dateTo")     ?? undefined
  const exerciceIdParam = searchParams.get("exerciceId") ?? undefined

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
  if (exerciceIdParam === "none") where.exerciceId = null
  else if (exerciceIdParam) where.exerciceId = exerciceIdParam

  const include = {
    category:       { select: { name: true, type: true } },
    reconciliations: {
      select: {
        id: true,
        bankTransaction: { select: { bankAccount: { select: { accountName: true } } } },
      },
    },
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
}, { roles: FINANCE, module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = expenseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, vendor, description, receiptUrl, internalNote, paymentMethod, ...rest } = parsed.data
  const expenseDate = new Date(date)

  const exercice = await resolveExerciceForDate(associationId, expenseDate)
  const guard = closedExerciceGuard(exercice?.status)
  if (guard) return guard

  const expense = await prisma.expense.create({
    data: {
      ...rest,
      associationId,
      exerciceId:    exercice?.id ?? null,
      date:          expenseDate,
      categoryId:    categoryId    || null,
      vendor:        vendor        || null,
      description:   description   || null,
      receiptUrl:    receiptUrl    || null,
      internalNote:  internalNote  || null,
      paymentMethod: paymentMethod || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "EXPENSE_CREATED", entity: "Expense", entityId: expense.id, label: description || vendor || `Dépense ${Number(expense.amount)}€`, metadata: { amount: Number(expense.amount) } })
  return NextResponse.json(expense, { status: 201 })
}, { roles: FINANCE, module: "finances" })

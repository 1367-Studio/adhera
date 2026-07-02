import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { financeCategorySchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") ?? undefined

  const categories = await prisma.financeCategory.findMany({
    where:   { associationId, ...(type ? { type: type as "INCOME" | "EXPENSE" } : {}) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: { _count: { select: { incomes: true, expenses: true } } },
  })
  return NextResponse.json(categories)
}, { roles: FINANCE, module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = financeCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const category = await prisma.financeCategory.create({
    data: { ...parsed.data, associationId, accountingCode: parsed.data.accountingCode || null },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_CREATED", entity: "FinanceCategory", entityId: category.id, label: category.name })
  return NextResponse.json(category, { status: 201 })
}, { roles: FINANCE, module: "finances" })

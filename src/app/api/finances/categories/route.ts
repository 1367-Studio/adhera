import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { financeCategorySchema } from "@/lib/schemas"
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
  const type = searchParams.get("type") ?? undefined

  const categories = await prisma.financeCategory.findMany({
    where:   { associationId, ...(type ? { type: type as "INCOME" | "EXPENSE" } : {}) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  })
  return NextResponse.json(categories)
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
  const parsed = financeCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const category = await prisma.financeCategory.create({
    data: { ...parsed.data, associationId, accountingCode: parsed.data.accountingCode || null },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_CREATED", entity: "FinanceCategory", entityId: category.id, label: category.name })
  return NextResponse.json(category, { status: 201 })
}

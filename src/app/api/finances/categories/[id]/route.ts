import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { financeCategoryUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.financeCategory.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = financeCategoryUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const category = await prisma.financeCategory.update({
    where: { id },
    data:  { ...parsed.data, accountingCode: parsed.data.accountingCode ?? undefined },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_UPDATED", entity: "FinanceCategory", entityId: id, label: category.name })
  return NextResponse.json(category)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.financeCategory.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 })

  await prisma.financeCategory.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_DELETED", entity: "FinanceCategory", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}

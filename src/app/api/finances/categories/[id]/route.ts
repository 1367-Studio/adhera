import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { financeCategoryUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

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
}, { roles: FINANCE, module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.financeCategory.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 })

  await prisma.financeCategory.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_DELETED", entity: "FinanceCategory", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}, { roles: FINANCE, module: "finances" })

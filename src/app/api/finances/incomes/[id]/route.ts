import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { incomeUpdateSchema } from "@/lib/schemas"
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
  const existing = await prisma.income.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = incomeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, memberId, paymentMethod, description, reference, ...rest } = parsed.data
  const income = await prisma.income.update({
    where: { id },
    data:  {
      ...rest,
      ...(date          ? { date: new Date(date) } : {}),
      ...(categoryId    !== undefined ? { categoryId:    categoryId    || null } : {}),
      ...(memberId      !== undefined ? { memberId:      memberId      || null } : {}),
      ...(paymentMethod !== undefined ? { paymentMethod: paymentMethod || null } : {}),
      ...(description   !== undefined ? { description:   description   || null } : {}),
      ...(reference     !== undefined ? { reference:     reference     || null } : {}),
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "INCOME_UPDATED", entity: "Income", entityId: id })
  return NextResponse.json(income)
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
  const existing = await prisma.income.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })

  // Find linked bank transactions before deleting the reconciliation link
  const reconciliations = await prisma.bankReconciliation.findMany({
    where: { incomeId: id },
    select: { bankTransactionId: true },
  })
  const txIds = reconciliations.map(r => r.bankTransactionId)

  await prisma.$transaction([
    prisma.bankReconciliation.deleteMany({ where: { incomeId: id } }),
    // Reset orphaned transactions back to UNMATCHED so they can be re-reconciled
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" } })]
      : []),
    prisma.income.delete({ where: { id } }),
  ])

  await writeActivityLog({ associationId, actorId: userId, action: "INCOME_DELETED", entity: "Income", entityId: id })
  return new NextResponse(null, { status: 204 })
}

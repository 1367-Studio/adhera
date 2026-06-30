import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { expenseUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.expense.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = expenseUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, vendor, description, receiptUrl, internalNote, ...rest } = parsed.data
  const expense = await prisma.expense.update({
    where: { id },
    data:  {
      ...rest,
      ...(date         ? { date: new Date(date) } : {}),
      ...(categoryId   !== undefined ? { categoryId:   categoryId   || null } : {}),
      ...(vendor       !== undefined ? { vendor:       vendor       || null } : {}),
      ...(description  !== undefined ? { description:  description  || null } : {}),
      ...(receiptUrl   !== undefined ? { receiptUrl:   receiptUrl   || null } : {}),
      ...(internalNote !== undefined ? { internalNote: internalNote || null } : {}),
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "EXPENSE_UPDATED", entity: "Expense", entityId: id })
  return NextResponse.json(expense)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.expense.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

  // Find linked bank transactions before deleting the reconciliation link
  const reconciliations = await prisma.bankReconciliation.findMany({
    where: { expenseId: id },
    select: { bankTransactionId: true },
  })
  const txIds = reconciliations.map(r => r.bankTransactionId)

  await prisma.$transaction([
    prisma.bankReconciliation.deleteMany({ where: { expenseId: id } }),
    // Reset orphaned transactions back to UNMATCHED so they can be re-reconciled
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" } })]
      : []),
    prisma.expense.delete({ where: { id } }),
  ])

  await writeActivityLog({ associationId, actorId: userId, action: "EXPENSE_DELETED", entity: "Expense", entityId: id })
  return new NextResponse(null, { status: 204 })
}

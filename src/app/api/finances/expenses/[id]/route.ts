import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { expenseUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.expense.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = expenseUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, categoryId, vendor, description, receiptUrl, internalNote, ...rest } = parsed.data

  // If status moves away from VALIDATED, any bank reconciliation for this expense is no
  // longer valid — unlink it and reset the transaction, mirroring what DELETE already does.
  const leavesValidated = rest.status !== undefined && rest.status !== "VALIDATED" && existing.status === "VALIDATED"
  const reconciliations = leavesValidated
    ? await prisma.bankReconciliation.findMany({ where: { expenseId: id }, select: { bankTransactionId: true } })
    : []
  const txIds = reconciliations.map(r => r.bankTransactionId)

  const [expense] = await prisma.$transaction([
    prisma.expense.update({
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
    }),
    ...(leavesValidated ? [prisma.bankReconciliation.deleteMany({ where: { expenseId: id } })] : []),
    ...(txIds.length > 0
      ? [prisma.bankTransaction.updateMany({ where: { id: { in: txIds } }, data: { status: "UNMATCHED" as const } })]
      : []),
  ])

  await writeActivityLog({ associationId, actorId: userId, action: "EXPENSE_UPDATED", entity: "Expense", entityId: id })
  return NextResponse.json(expense)
}, { roles: FINANCE, module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

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
}, { roles: FINANCE, module: "finances" })

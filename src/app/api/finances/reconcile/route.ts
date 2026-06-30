import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { reconcileActionSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body   = await req.json()
  const parsed = reconcileActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { bankTransactionId, action, incomeId, expenseId } = parsed.data

  const tx = await prisma.bankTransaction.findFirst({ where: { id: bankTransactionId, associationId } })
  if (!tx) return NextResponse.json({ error: "Transaction introuvable" }, { status: 404 })

  if (action === "IGNORE") {
    await prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "IGNORED" } })
    await writeActivityLog({ associationId, actorId: userId, action: "TX_IGNORED", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label })
    return NextResponse.json({ status: "IGNORED" })
  }

  if (action === "DUPLICATE") {
    await prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "DUPLICATE" } })
    await writeActivityLog({ associationId, actorId: userId, action: "TX_MARKED_DUPLICATE", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label })
    return NextResponse.json({ status: "DUPLICATE" })
  }

  if (action === "MATCH") {
    if (!incomeId && !expenseId) {
      return NextResponse.json({ error: "incomeId ou expenseId requis pour MATCH" }, { status: 422 })
    }
    if (incomeId && expenseId) {
      return NextResponse.json({ error: "incomeId et expenseId ne peuvent pas être fournis simultanément" }, { status: 422 })
    }
    if (tx.status === "MATCHED") {
      return NextResponse.json({ error: "Transaction déjà conciliée" }, { status: 409 })
    }

    if (incomeId) {
      const income = await prisma.income.findFirst({ where: { id: incomeId, associationId } })
      if (!income) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })

      await prisma.$transaction([
        prisma.bankReconciliation.create({
          data: {
            associationId,
            bankTransactionId,
            incomeId,
            matchScore:      0,
            matchedBy:       "USER",
            matchedByUserId: userId,
          },
        }),
        prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "MATCHED" } }),
        prisma.income.update({ where: { id: incomeId }, data: { status: "PAID" } }),
      ])

      await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_INCOME", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { incomeId } })
    } else if (expenseId) {
      const expense = await prisma.expense.findFirst({ where: { id: expenseId, associationId } })
      if (!expense) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

      await prisma.$transaction([
        prisma.bankReconciliation.create({
          data: {
            associationId,
            bankTransactionId,
            expenseId,
            matchScore:      0,
            matchedBy:       "USER",
            matchedByUserId: userId,
          },
        }),
        prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "MATCHED" } }),
        prisma.expense.update({ where: { id: expenseId }, data: { status: "VALIDATED" } }),
      ])

      await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_EXPENSE", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { expenseId } })
    }

    return NextResponse.json({ status: "MATCHED" })
  }

  return NextResponse.json({ error: "Action invalide" }, { status: 422 })
}

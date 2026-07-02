import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { reconcileActionSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

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

    try {
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
    } catch (err) {
      // Unique constraint on incomeId/expenseId — this record is already linked to
      // another bank transaction.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: "Cette recette/dépense est déjà conciliée avec une autre transaction" }, { status: 409 })
      }
      throw err
    }

    return NextResponse.json({ status: "MATCHED" })
  }

  if (action === "UNMATCH") {
    if (tx.status !== "MATCHED") {
      return NextResponse.json({ error: "Transaction non conciliée" }, { status: 409 })
    }

    const reconciliation = await prisma.bankReconciliation.findFirst({
      where: { bankTransactionId, associationId },
    })

    await prisma.$transaction([
      ...(reconciliation ? [prisma.bankReconciliation.delete({ where: { id: reconciliation.id } })] : []),
      prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "UNMATCHED" } }),
      ...(reconciliation?.incomeId
        ? [prisma.income.updateMany({ where: { id: reconciliation.incomeId, status: "PAID" }, data: { status: "PENDING" } })]
        : []),
      ...(reconciliation?.expenseId
        ? [prisma.expense.updateMany({ where: { id: reconciliation.expenseId, status: "VALIDATED" }, data: { status: "DRAFT" } })]
        : []),
    ])

    await writeActivityLog({ associationId, actorId: userId, action: "TX_UNMATCHED", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label })
    return NextResponse.json({ status: "UNMATCHED" })
  }

  return NextResponse.json({ error: "Action invalide" }, { status: 422 })
}, { roles: FINANCE, module: "finances" })

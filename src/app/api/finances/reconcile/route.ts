import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { reconcileActionSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeMatchScore } from "@/lib/finance/match-score"
import { closedExerciceGuard } from "@/lib/finance/exercice"

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = reconcileActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { bankTransactionId, action, incomeId, expenseId, transferId } = parsed.data

  const tx = await prisma.bankTransaction.findFirst({
    where:   { id: bankTransactionId, associationId },
    include: { exercice: { select: { status: true } } },
  })
  if (!tx) return NextResponse.json({ error: "Transaction introuvable" }, { status: 404 })

  const txGuard = closedExerciceGuard(tx.exercice?.status)
  if (txGuard) return txGuard

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
    const targetCount = [incomeId, expenseId, transferId].filter(Boolean).length
    if (targetCount === 0) {
      return NextResponse.json({ error: "incomeId, expenseId ou transferId requis pour MATCH" }, { status: 422 })
    }
    if (targetCount > 1) {
      return NextResponse.json({ error: "Un seul de incomeId, expenseId ou transferId peut être fourni" }, { status: 422 })
    }
    if (tx.status === "MATCHED") {
      return NextResponse.json({ error: "Transaction déjà conciliée" }, { status: 409 })
    }

    try {
      if (incomeId) {
        const income = await prisma.income.findFirst({
          where:   { id: incomeId, associationId },
          include: { membre: { select: { firstName: true, lastName: true } }, exercice: { select: { status: true } } },
        })
        if (!income) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })

        const incomeGuard = closedExerciceGuard(income.exercice?.status)
        if (incomeGuard) return incomeGuard

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: income.amount, date: income.date, reference: income.reference, membre: income.membre },
        )

        await prisma.$transaction([
          prisma.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              incomeId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          }),
          prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "MATCHED" } }),
          prisma.income.update({ where: { id: incomeId }, data: { status: "PAID" } }),
        ])

        await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_INCOME", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { incomeId } })
      } else if (expenseId) {
        const expense = await prisma.expense.findFirst({
          where:   { id: expenseId, associationId },
          include: { exercice: { select: { status: true } } },
        })
        if (!expense) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

        const expenseGuard = closedExerciceGuard(expense.exercice?.status)
        if (expenseGuard) return expenseGuard

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: expense.amount, date: expense.date, reference: null, membre: null },
        )

        await prisma.$transaction([
          prisma.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              expenseId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          }),
          prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "MATCHED" } }),
          prisma.expense.update({ where: { id: expenseId }, data: { status: "VALIDATED" } }),
        ])

        await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_EXPENSE", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { expenseId } })
      } else if (transferId) {
        const transfer = await prisma.accountTransfer.findFirst({
          where:   { id: transferId, associationId },
          include: { exercice: { select: { status: true } } },
        })
        if (!transfer) return NextResponse.json({ error: "Transfert introuvable" }, { status: 404 })

        // A transfer has two legs, one per account — matching only makes sense against a
        // BankTransaction that actually belongs to one of those two accounts, otherwise this
        // bank transaction and this transfer have nothing to do with each other.
        if (tx.bankAccountId !== transfer.fromAccountId && tx.bankAccountId !== transfer.toAccountId) {
          return NextResponse.json({ error: "Ce transfert ne concerne pas le compte de cette transaction" }, { status: 422 })
        }

        const transferGuard = closedExerciceGuard(transfer.exercice?.status)
        if (transferGuard) return transferGuard

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: transfer.amount, date: transfer.date, reference: null, membre: null },
        )

        await prisma.$transaction([
          prisma.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              transferId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          }),
          prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "MATCHED" } }),
        ])

        await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_TRANSFER", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { transferId } })
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = Array.isArray(err.meta?.target) ? err.meta.target as string[] : []
        // Unique constraint on bankTransactionId — a concurrent request already matched
        // this same transaction between our status check above and this insert.
        if (target.includes("bankTransactionId")) {
          return NextResponse.json({ error: "Transaction déjà conciliée" }, { status: 409 })
        }
        // Unique constraint on incomeId/expenseId — this record is already linked to
        // another bank transaction.
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
      where:   { bankTransactionId, associationId },
      include: {
        income:   { select: { exercice: { select: { status: true } } } },
        expense:  { select: { exercice: { select: { status: true } } } },
        transfer: { select: { exercice: { select: { status: true } } } },
      },
    })

    const linkedGuard = closedExerciceGuard(
      reconciliation?.income?.exercice?.status ?? reconciliation?.expense?.exercice?.status ?? reconciliation?.transfer?.exercice?.status,
    )
    if (linkedGuard) return linkedGuard

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
}, { area: "comptabilite", module: "finances" })

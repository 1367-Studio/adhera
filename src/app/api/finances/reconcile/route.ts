import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { reconcileActionSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeMatchScore } from "@/lib/finance/match-score"
import { closedExerciceGuard } from "@/lib/finance/exercice"

const EPSILON = 0.01

// bankTransactionId stopped being @unique on BankReconciliation (FORM-116 block 8 — a grouped
// Stripe payout needs several reconciliation rows against the same transaction), which removed
// the DB-level guarantee that only one request can ever MATCH a given transaction. Replaces it:
// an atomic conditional update that only succeeds for the first of any concurrent/duplicate
// MATCH requests for the same bankTransactionId, same pattern as the webhook's idempotency
// guard. Call inside the same $transaction that creates the BankReconciliation row(s).
class TransactionAlreadyMatchedError extends Error {}
async function claimBankTransaction(tx: Prisma.TransactionClient, bankTransactionId: string) {
  const result = await tx.bankTransaction.updateMany({
    where: { id: bankTransactionId, status: { not: "MATCHED" } },
    data:  { status: "MATCHED" },
  })
  if (result.count === 0) throw new TransactionAlreadyMatchedError()
}

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = reconcileActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { bankTransactionId, action, incomeId, expenseId, transferId, reimbursementRequestId, incomeIds, expenseIds } = parsed.data

  const tx = await prisma.bankTransaction.findFirst({
    where:   { id: bankTransactionId, associationId },
    include: { exercice: { select: { status: true } } },
  })
  if (!tx) return NextResponse.json({ error: "Transaction introuvable" }, { status: 404 })

  const txGuard = await closedExerciceGuard(tx.exercice?.status)
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
    const hasGroup = (incomeIds && incomeIds.length > 0) || (expenseIds && expenseIds.length > 0)
    const targetCount = [incomeId, expenseId, transferId, reimbursementRequestId].filter(Boolean).length

    if (hasGroup && targetCount > 0) {
      return NextResponse.json({ error: "incomeIds/expenseIds ne peuvent pas être combinés avec incomeId/expenseId/transferId/reimbursementRequestId" }, { status: 422 })
    }
    if (!hasGroup && targetCount === 0) {
      return NextResponse.json({ error: "incomeId, expenseId, transferId, reimbursementRequestId ou incomeIds/expenseIds requis pour MATCH" }, { status: 422 })
    }
    if (!hasGroup && targetCount > 1) {
      return NextResponse.json({ error: "Un seul de incomeId, expenseId, transferId ou reimbursementRequestId peut être fourni" }, { status: 422 })
    }
    if (tx.status === "MATCHED") {
      return NextResponse.json({ error: "Transaction déjà conciliée" }, { status: 409 })
    }

    if (hasGroup) {
      // Grouped reconciliation stays same-direction only — mixing a CREDIT payout with a
      // DEBIT-side Expense isn't the scenario this exists for (netting several charges into
      // one payout), and would make the sum check below ambiguous about sign.
      if (tx.type === "CREDIT" && expenseIds && expenseIds.length > 0) {
        return NextResponse.json({ error: "Une transaction au crédit ne peut regrouper que des recettes" }, { status: 422 })
      }
      if (tx.type === "DEBIT" && incomeIds && incomeIds.length > 0) {
        return NextResponse.json({ error: "Une transaction au débit ne peut regrouper que des dépenses" }, { status: 422 })
      }

      const [incomes, expenses] = await Promise.all([
        incomeIds?.length
          ? prisma.income.findMany({ where: { id: { in: incomeIds }, associationId }, include: { exercice: { select: { status: true } } } })
          : Promise.resolve([]),
        expenseIds?.length
          ? prisma.expense.findMany({ where: { id: { in: expenseIds }, associationId }, include: { exercice: { select: { status: true } } } })
          : Promise.resolve([]),
      ])
      if (incomes.length !== (incomeIds?.length ?? 0)) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })
      if (expenses.length !== (expenseIds?.length ?? 0)) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

      for (const income of incomes) {
        const guard = await closedExerciceGuard(income.exercice?.status)
        if (guard) return guard
      }
      for (const expense of expenses) {
        const guard = await closedExerciceGuard(expense.exercice?.status)
        if (guard) return guard
      }

      const sum = incomes.reduce((s, i) => s + Number(i.amount), 0) + expenses.reduce((s, e) => s + Number(e.amount), 0)
      if (Math.abs(sum - Number(tx.amount)) > EPSILON) {
        return NextResponse.json({ error: `La somme sélectionnée (${sum.toFixed(2)} €) ne correspond pas au montant de la transaction (${Number(tx.amount).toFixed(2)} €)` }, { status: 422 })
      }

      try {
        await prisma.$transaction(async (txClient) => {
          await claimBankTransaction(txClient, bankTransactionId)

          for (const income of incomes) {
            const matchScore = computeMatchScore(
              { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
              { amount: income.amount, date: income.date, reference: income.reference, membre: null },
            )
            await txClient.bankReconciliation.create({
              data: { associationId, bankTransactionId, incomeId: income.id, matchScore, matchedBy: "USER", matchedByUserId: userId },
            })
            await txClient.income.update({ where: { id: income.id }, data: { status: "PAID" } })
          }
          for (const expense of expenses) {
            const matchScore = computeMatchScore(
              { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
              { amount: expense.amount, date: expense.date, reference: null, membre: null },
            )
            await txClient.bankReconciliation.create({
              data: { associationId, bankTransactionId, expenseId: expense.id, matchScore, matchedBy: "USER", matchedByUserId: userId },
            })
            await txClient.expense.update({ where: { id: expense.id }, data: { status: "VALIDATED" } })
          }
        })

        await writeActivityLog({
          associationId, actorId: userId, action: "TX_MATCHED_GROUP", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label,
          metadata: { incomeIds: incomeIds ?? [], expenseIds: expenseIds ?? [] },
        })
      } catch (err) {
        if (err instanceof TransactionAlreadyMatchedError) {
          return NextResponse.json({ error: "Transaction déjà conciliée" }, { status: 409 })
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return NextResponse.json({ error: "Une des recettes/dépenses sélectionnées est déjà conciliée avec une autre transaction" }, { status: 409 })
        }
        throw err
      }

      return NextResponse.json({ status: "MATCHED" })
    }

    try {
      if (incomeId) {
        const income = await prisma.income.findFirst({
          where:   { id: incomeId, associationId },
          include: { membre: { select: { firstName: true, lastName: true } }, exercice: { select: { status: true } } },
        })
        if (!income) return NextResponse.json({ error: "Recette introuvable" }, { status: 404 })

        const incomeGuard = await closedExerciceGuard(income.exercice?.status)
        if (incomeGuard) return incomeGuard

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: income.amount, date: income.date, reference: income.reference, membre: income.membre },
        )

        await prisma.$transaction(async (txClient) => {
          await claimBankTransaction(txClient, bankTransactionId)
          await txClient.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              incomeId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          })
          await txClient.income.update({ where: { id: incomeId }, data: { status: "PAID" } })
        })

        await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_INCOME", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { incomeId } })
      } else if (expenseId) {
        const expense = await prisma.expense.findFirst({
          where:   { id: expenseId, associationId },
          include: { exercice: { select: { status: true } } },
        })
        if (!expense) return NextResponse.json({ error: "Dépense introuvable" }, { status: 404 })

        const expenseGuard = await closedExerciceGuard(expense.exercice?.status)
        if (expenseGuard) return expenseGuard

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: expense.amount, date: expense.date, reference: null, membre: null },
        )

        await prisma.$transaction(async (txClient) => {
          await claimBankTransaction(txClient, bankTransactionId)
          await txClient.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              expenseId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          })
          await txClient.expense.update({ where: { id: expenseId }, data: { status: "VALIDATED" } })
        })

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

        const transferGuard = await closedExerciceGuard(transfer.exercice?.status)
        if (transferGuard) return transferGuard

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: transfer.amount, date: transfer.date, reference: null, membre: null },
        )

        await prisma.$transaction(async (txClient) => {
          await claimBankTransaction(txClient, bankTransactionId)
          await txClient.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              transferId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          })
        })

        await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_TRANSFER", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { transferId } })
      } else if (reimbursementRequestId) {
        // FORM-93 — supports reconciling retroactively from the generic Conciliation screen,
        // in addition to the inline pick offered at reimbursement-registration time. Only a
        // REIMBURSED request can be matched: that's the point in the workflow where the
        // payment actually happened.
        const request = await prisma.reimbursementRequest.findFirst({ where: { id: reimbursementRequestId, associationId } })
        if (!request) return NextResponse.json({ error: "Demande de remboursement introuvable" }, { status: 404 })
        if (request.status !== "REIMBURSED") {
          return NextResponse.json({ error: "Cette demande n'a pas encore été remboursée" }, { status: 422 })
        }

        const matchScore = computeMatchScore(
          { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
          { amount: request.totalAmount, date: tx.transactionDate, reference: null, membre: null },
        )

        await prisma.$transaction(async (txClient) => {
          await claimBankTransaction(txClient, bankTransactionId)
          await txClient.bankReconciliation.create({
            data: {
              associationId,
              bankTransactionId,
              reimbursementRequestId,
              matchScore,
              matchedBy:       "USER",
              matchedByUserId: userId,
            },
          })
        })

        await writeActivityLog({ associationId, actorId: userId, action: "TX_MATCHED_REIMBURSEMENT", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label, metadata: { reimbursementRequestId } })
      }
    } catch (err) {
      if (err instanceof TransactionAlreadyMatchedError) {
        return NextResponse.json({ error: "Transaction déjà conciliée" }, { status: 409 })
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Unique constraint on incomeId/expenseId/reimbursementRequestId — this record is
        // already linked to another bank transaction.
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

    // findMany, not findFirst — a grouped reconciliation (FORM-116 block 8) leaves several
    // BankReconciliation rows against this one transaction; UNMATCH undoes all of them together.
    const reconciliations = await prisma.bankReconciliation.findMany({
      where:   { bankTransactionId, associationId },
      include: {
        income:   { select: { exercice: { select: { status: true } } } },
        expense:  { select: { exercice: { select: { status: true } } } },
        transfer: { select: { exercice: { select: { status: true } } } },
      },
    })

    for (const reconciliation of reconciliations) {
      const guard = await closedExerciceGuard(
        reconciliation.income?.exercice?.status ?? reconciliation.expense?.exercice?.status ?? reconciliation.transfer?.exercice?.status,
      )
      if (guard) return guard
    }

    const incomeIdsToRelease  = reconciliations.map(r => r.incomeId).filter((id): id is string => id != null)
    const expenseIdsToRelease = reconciliations.map(r => r.expenseId).filter((id): id is string => id != null)

    await prisma.$transaction([
      prisma.bankReconciliation.deleteMany({ where: { bankTransactionId, associationId } }),
      prisma.bankTransaction.update({ where: { id: bankTransactionId }, data: { status: "UNMATCHED" } }),
      ...(incomeIdsToRelease.length
        ? [prisma.income.updateMany({ where: { id: { in: incomeIdsToRelease }, status: "PAID" }, data: { status: "PENDING" } })]
        : []),
      ...(expenseIdsToRelease.length
        ? [prisma.expense.updateMany({ where: { id: { in: expenseIdsToRelease }, status: "VALIDATED" }, data: { status: "DRAFT" } })]
        : []),
    ])

    await writeActivityLog({ associationId, actorId: userId, action: "TX_UNMATCHED", entity: "BankTransaction", entityId: bankTransactionId, label: tx.label })
    return NextResponse.json({ status: "UNMATCHED" })
  }

  return NextResponse.json({ error: "Action invalide" }, { status: 422 })
}, { area: "comptabilite", module: "finances" })

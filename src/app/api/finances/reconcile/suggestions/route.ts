import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { computeMatchScore } from "@/lib/finance/match-score"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const bankTransactionId = searchParams.get("bankTransactionId")
  if (!bankTransactionId) {
    return NextResponse.json({ error: "bankTransactionId requis" }, { status: 422 })
  }

  const tx = await prisma.bankTransaction.findFirst({
    where: { id: bankTransactionId, associationId },
  })
  if (!tx) return NextResponse.json({ error: "Transaction introuvable" }, { status: 404 })

  const dateFrom = new Date(tx.transactionDate)
  dateFrom.setDate(dateFrom.getDate() - 7)
  const dateTo = new Date(tx.transactionDate)
  dateTo.setDate(dateTo.getDate() + 7)

  const [incomes, expenses, transfers] = await Promise.all([
    tx.type === "CREDIT"
      ? prisma.income.findMany({
          where: {
            associationId,
            status: { not: "CANCELLED" },
            reconciliations: { none: {} },
            date: { gte: dateFrom, lte: dateTo },
          },
          include: { membre: { select: { firstName: true, lastName: true } } },
          take: 20,
        })
      : Promise.resolve([]),
    tx.type === "DEBIT"
      ? prisma.expense.findMany({
          where: {
            associationId,
            status: { not: "CANCELLED" },
            reconciliations: { none: {} },
            date: { gte: dateFrom, lte: dateTo },
          },
          take: 20,
        })
      : Promise.resolve([]),
    // A transfer has two legs matched independently (BankReconciliation.transferId isn't
    // unique — see its doc comment in schema.prisma), so "already suggested" has to mean
    // "this specific account's leg is already matched", not "the transfer has any match at
    // all" — otherwise matching the first leg would hide the transfer from the second
    // account's own suggestions. Direction matters too: a DEBIT (money leaving this account)
    // can only be this transfer's fromAccount leg, a CREDIT only its toAccount leg.
    prisma.accountTransfer.findMany({
      where: {
        associationId,
        date: { gte: dateFrom, lte: dateTo },
        ...(tx.type === "DEBIT" ? { fromAccountId: tx.bankAccountId } : { toAccountId: tx.bankAccountId }),
        reconciliations: { none: { bankTransaction: { bankAccountId: tx.bankAccountId } } },
      },
      include: {
        fromAccount: { select: { accountName: true, bankName: true } },
        toAccount:   { select: { accountName: true, bankName: true } },
      },
      take: 20,
    }),
  ])

  const incomeSuggestions = incomes.map(income => ({
    type:   "income" as const,
    entity: income,
    score:  Math.min(100, Math.round((computeMatchScore(
      { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
      { amount: income.amount, date: income.date, description: income.description, reference: income.reference, membre: income.membre },
    ) / 120) * 100)),
  }))

  const expenseSuggestions = expenses.map(expense => ({
    type:   "expense" as const,
    entity: expense,
    score:  Math.min(100, Math.round((computeMatchScore(
      { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
      { amount: expense.amount, date: expense.date, description: expense.description, reference: null },
    ) / 120) * 100)),
  }))

  const transferSuggestions = transfers.map(transfer => ({
    type:   "transfer" as const,
    entity: transfer,
    score:  Math.min(100, Math.round((computeMatchScore(
      { amount: tx.amount, transactionDate: tx.transactionDate, label: tx.label },
      { amount: transfer.amount, date: transfer.date },
    ) / 120) * 100)),
  }))

  const suggestions = [...incomeSuggestions, ...expenseSuggestions, ...transferSuggestions]
    .filter(s => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return NextResponse.json({ transaction: tx, suggestions })
}, { area: "comptabilite", module: "finances" })

import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { computeMatchScore } from "@/lib/finance/match-score"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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

  const [incomes, expenses] = await Promise.all([
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

  const suggestions = [...incomeSuggestions, ...expenseSuggestions]
    .filter(s => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return NextResponse.json({ transaction: tx, suggestions })
}

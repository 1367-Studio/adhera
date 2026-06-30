import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const now        = new Date()
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const year       = now.getFullYear()

  const [
    membresActifs,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsPayees,
    totalIncomes,
    totalExpenses,
    prochainEvenement,
  ] = await Promise.all([
    prisma.membre.count({ where: { associationId, status: "ACTIF", deletedAt: null } }),
    prisma.evenement.count({ where: { associationId, date: { gte: startMonth, lte: endMonth } } }),
    prisma.cotisation.count({ where: { associationId, status: "EN_ATTENTE", year } }),
    prisma.cotisation.aggregate({
      where: { associationId, status: "PAYE", year },
      _sum: { amount: true },
    }),
    prisma.income.aggregate({
      where: { associationId, status: "PAID" },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { associationId, status: { not: "CANCELLED" } },
      _sum: { amount: true },
    }),
    prisma.evenement.findFirst({
      where: { associationId, date: { gte: now } },
      orderBy: { date: "asc" },
      select: { id: true, title: true, date: true, location: true },
    }),
  ])

  const solde = Number(totalIncomes._sum.amount ?? 0) - Number(totalExpenses._sum.amount ?? 0)
  const cotisationsEncaissees = Number(cotisationsPayees._sum.amount ?? 0)

  return NextResponse.json({
    membresActifs,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsEncaissees,
    solde,
    prochainEvenement,
  })
}

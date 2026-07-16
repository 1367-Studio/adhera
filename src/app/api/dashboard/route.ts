import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (req, ctx) => {
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
    ventesRecentes,
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
      where: { associationId, status: "VALIDATED" },
      _sum: { amount: true },
    }),
    prisma.evenement.findFirst({
      where: { associationId, date: { gte: now } },
      orderBy: { date: "asc" },
      select: { id: true, title: true, date: true, location: true },
    }),
    prisma.boutiqueCommande.findMany({
      where:   { associationId, status: "PAID" },
      // `paidAt` (not `updatedAt`) — a later payment-type correction on an old sale
      // updates the row without changing when it was actually paid, and ordering by
      // `updatedAt` would resurface that old sale at the top of "Ventes récentes".
      orderBy: { paidAt: "desc" },
      take:    5,
      select: {
        id:          true,
        totalAmount: true,
        paidAt:      true,
        updatedAt:   true,
        guestName:   true,
        membre:      { select: { firstName: true, lastName: true } },
      },
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
    ventesRecentes,
  })
})

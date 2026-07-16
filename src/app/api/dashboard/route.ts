import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const now        = new Date()
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const year       = now.getFullYear()
  // Only orders still fresh enough to plausibly need action get the priority boost — with
  // no cleanup job for abandoned Stripe checkouts or forgotten manual pickups, an unbounded
  // PENDING query would let a months-old dead cart permanently occupy a dashboard slot.
  // Past this window a PENDING order still shows up in the boutique's own commandes list,
  // just without crowding out real recent activity here.
  const pendingCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const [
    membresActifs,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsPayees,
    totalIncomes,
    totalExpenses,
    prochainEvenement,
    commandesEnAttente,
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
    // Pending orders need action (encaisser a manual one, chase up a stalled Stripe one) —
    // ranked ahead of already-settled sales the admin can't act on anymore, but the list
    // is still filled out to 5 with recent PAID sales below them (see below).
    prisma.boutiqueCommande.findMany({
      where:   { associationId, status: "PENDING", createdAt: { gte: pendingCutoff } },
      orderBy: { createdAt: "desc" },
      take:    5,
      select: {
        id:          true,
        totalAmount: true,
        createdAt:   true,
        guestName:   true,
        membre:      { select: { firstName: true, lastName: true } },
      },
    }),
  ])

  const remainingSlots = 5 - commandesEnAttente.length
  const ventesPayees = remainingSlots > 0
    ? await prisma.boutiqueCommande.findMany({
        where:   { associationId, status: "PAID" },
        // `paidAt` (not `updatedAt`) — a later payment-type correction on an old sale
        // updates the row without changing when it was actually paid, and ordering by
        // `updatedAt` would resurface that old sale at the top of the list.
        orderBy: { paidAt: "desc" },
        take:    remainingSlots,
        select: {
          id:          true,
          totalAmount: true,
          paidAt:      true,
          // Fallback source for `date` below — `paidAt` should always be set on a PAID row
          // (backfilled by migration, always written going forward), but nothing here
          // actually enforces that at the DB level, so a null slipping through renders a
          // real date instead of silently producing "1 Jan 1970".
          createdAt:   true,
          guestName:   true,
          membre:      { select: { firstName: true, lastName: true } },
        },
      })
    : []

  const ventesRecentes = [
    ...commandesEnAttente.map(c => ({ ...c, date: c.createdAt, status: "PENDING" as const })),
    ...ventesPayees.map(c => ({ ...c, date: c.paidAt ?? c.createdAt, status: "PAID" as const })),
  ]

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

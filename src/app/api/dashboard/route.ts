import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same gate as /api/dons and the sidebar's Dons entry — a role that can't open the dons
// list must not receive its yearly total here either (see donsRecus below).
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Shared by the pending and paid halves of the dons card so both sides carry identical
// fields — the card renders one list out of the two and can't branch on their shape.
const DON_CARD_SELECT = {
  id:          true,
  amount:      true,
  donorType:   true,
  firstName:   true,
  lastName:    true,
  companyName: true,
  anonymous:   true,
  paidAt:      true,
  createdAt:   true,
} as const

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

  const canSeeDons = FINANCE.includes(ctx.role)

  const [
    membresActifs,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsPayees,
    cotisationsPartielles,
    totalIncomes,
    totalExpenses,
    prochainEvenement,
    commandesEnAttente,
    materielEnRetardCount,
    materielEmpruntsListe,
    donsAnnee,
    donsEnAttente,
  ] = await Promise.all([
    prisma.membre.count({ where: { associationId, status: "ACTIF", deletedAt: null } }),
    prisma.evenement.count({ where: { associationId, date: { gte: startMonth, lte: endMonth } } }),
    // A partially-paid or already-late cotisation still owes something — counts as pending
    // here too (EN_RETARD is exactly "still pending, past due", not a separate bucket).
    prisma.cotisation.count({ where: { associationId, status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] }, year } }),
    prisma.cotisation.aggregate({
      where: { associationId, status: "PAYE", year },
      _sum: { amount: true },
    }),
    // Money actually collected on cotisations that aren't fully settled yet — without this,
    // partial payments wouldn't count as "encaissé" until the balance is paid off in full,
    // understating real cash received (the Income rows behind them are already correct in
    // Finances; this just mirrors that here). Summed separately from cotisationsPayees
    // above (which uses the cotisation's full amount) rather than switching that one to sum
    // CotisationPayment directly, since cotisations marked PAYE before this feature existed
    // have amountPaid=0 with no payment rows behind them at all. Includes EN_RETARD too — a
    // partially-paid cotisation whose due date has since passed still has real money
    // collected against it; only its status changed, not what's actually been received.
    prisma.cotisation.aggregate({
      where: { associationId, status: { in: ["PARTIELLEMENT_PAYEE", "EN_RETARD"] }, year },
      _sum: { amountPaid: true },
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
    // Same "overdue" definition as the per-item badge on the matériel page itself
    // (src/app/api/materiel/route.ts) — a CONFIRME loan, not yet returned, past its due
    // date. Counted separately from the findMany below (which covers every active loan,
    // not just overdue ones) so the card can still flag how many need action.
    prisma.materialLoan.count({
      where: {
        material:         { associationId },
        status:           "CONFIRME",
        returnedAt:       null,
        expectedReturnAt: { lt: now },
      },
    }),
    // Every active loan (borrowed and not yet returned), not just overdue ones — the
    // client asked to see what's currently on loan, not only what's late. Oldest due
    // date first: overdue loans (due date in the past) sort ahead of loans still on
    // track this way, with undated loans last since they're not time-pressured at all.
    // Capped at 5 like the other dashboard lists since this is a glanceable summary,
    // not the full matériel page.
    prisma.materialLoan.findMany({
      where: {
        material:   { associationId },
        status:     "CONFIRME",
        returnedAt: null,
      },
      orderBy: { expectedReturnAt: { sort: "asc", nulls: "last" } },
      take:    5,
      select: {
        id:               true,
        expectedReturnAt: true,
        borrowerName:     true,
        material:         { select: { name: true } },
        membre:           { select: { firstName: true, lastName: true } },
      },
    }),
    // Encaissés only, scoped to the current year — the exact window the Dons page's own
    // "Total {year}" KPI uses (paidAt within the year implies paidAt not null), so the tile
    // and the page it links to never show two different numbers.
    canSeeDons
      ? prisma.don.aggregate({
          where: { associationId, paidAt: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } },
          _sum:  { amount: true },
        })
      : Promise.resolve(null),
    // Offline dons (espèces/chèque/virement) still awaiting encaissement — exactly the
    // bucket the Dons page's own "en attente" table uses. Ordered by createdAt, not paidAt:
    // every row here has paidAt null by definition, so ordering by it would be arbitrary.
    canSeeDons
      ? prisma.don.findMany({
          where:   { associationId, paidAt: null, paymentMethod: { in: ["ESPECES", "CHEQUE", "VIREMENT"] } },
          orderBy: { createdAt: "desc" },
          take:    5,
          select:  DON_CARD_SELECT,
        })
      : [],
  ])

  // Both "fill the remaining slots" queries depend on a count from the batch above, so they
  // can't join it — but they don't depend on each other either, so they share one round-trip
  // rather than running back to back.
  const donsSlots      = 5 - donsEnAttente.length
  const remainingSlots = 5 - commandesEnAttente.length

  const [donsPayes, ventesPayees] = await Promise.all([
    canSeeDons && donsSlots > 0
      ? prisma.don.findMany({
          where:   { associationId, paidAt: { not: null } },
          orderBy: { paidAt: "desc" },
          take:    donsSlots,
          select:  DON_CARD_SELECT,
        })
      : [],
    remainingSlots > 0
      ? prisma.boutiqueCommande.findMany({
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
      : [],
  ])

  const ventesRecentes = [
    ...commandesEnAttente.map(c => ({ ...c, date: c.createdAt, status: "PENDING" as const })),
    ...ventesPayees.map(c => ({ ...c, date: c.paidAt ?? c.createdAt, status: "PAID" as const })),
  ]

  const solde = Number(totalIncomes._sum.amount ?? 0) - Number(totalExpenses._sum.amount ?? 0)
  const cotisationsEncaissees = Number(cotisationsPayees._sum.amount ?? 0) + Number(cotisationsPartielles._sum.amountPaid ?? 0)

  // Same PENDING-block-then-PAID-block shape as ventesRecentes above, so the card can find
  // the boundary by watching for a status change between two consecutive rows.
  const donsRecents = [
    ...donsEnAttente.map(d => ({ ...d, amount: Number(d.amount), date: d.createdAt, status: "PENDING" as const })),
    ...donsPayes.map(d => ({ ...d, amount: Number(d.amount), date: d.paidAt ?? d.createdAt, status: "PAID" as const })),
  ]

  // null (not 0) for a role that can't see dons — the tile is hidden for them anyway, and a
  // 0 would read as "no donations this year" rather than "not your data".
  const donsRecus = canSeeDons ? Number(donsAnnee?._sum.amount ?? 0) : null

  return NextResponse.json({
    membresActifs,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsEncaissees,
    solde,
    donsRecus,
    donsRecents,
    prochainEvenement,
    ventesRecentes,
    materielEnRetardCount,
    materielEmpruntsListe: materielEmpruntsListe.map(l => ({
      id:               l.id,
      materialName:     l.material.name,
      borrowerName:     l.membre ? `${l.membre.firstName} ${l.membre.lastName}` : (l.borrowerName ?? "—"),
      expectedReturnAt: l.expectedReturnAt,
      isOverdue:        !!l.expectedReturnAt && l.expectedReturnAt < now,
    })),
  })
})

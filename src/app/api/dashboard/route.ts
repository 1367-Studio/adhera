import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementNotOverWhere } from "@/lib/evenement-timing"
import { withAdminAuth } from "@/lib/api-wrapper"
import { hasAccess } from "@/lib/permissions"
import { buildTacheWhere } from "@/lib/tache-query"

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

  // Same gate as /api/dons and the sidebar's Dons entry — a user who can't open the dons
  // list must not receive its yearly total here either (see donsRecus below).
  const canSeeDons = hasAccess(ctx.permissions, "dons", "read")
  // Same idea for the balance: it is the Comptabilité area's figure (stat-solde widget).
  const canSeeBalance = hasAccess(ctx.permissions, "comptabilite", "read")
  // "Mes tâches" (FORM-118) only means something for a staff User who is also a Membre — a
  // pure staff account with no Membre row can never be assigned a Tache, so there is nothing
  // to count. null (not 0) distinguishes "hidden, no Membre" from "0 tâches ouvertes".
  const canSeeTaches = hasAccess(ctx.permissions, "taches", "read")

  const [
    membresActifs,
    membresTotal,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsPayees,
    cotisationsPartielles,
    cotisationsRestantes,
    totalIncomes,
    totalExpenses,
    prochainEvenement,
    commandesEnAttente,
    materielEnRetardCount,
    materielEmpruntsListe,
    donsAnnee,
    donsEnAttente,
    donsEnAttenteCount,
    mesTachesRaw,
  ] = await Promise.all([
    prisma.membre.count({ where: { associationId, status: "ACTIF", deletedAt: null } }),
    // Every status counts as a member (PENDING/INACTIF/SUSPENDU included) — the header
    // summary shows it as total, with inactive = total - actifs.
    prisma.membre.count({ where: { associationId, deletedAt: null } }),
    prisma.evenement.count({ where: { associationId, date: { gte: startMonth, lte: endMonth } } }),
    // A partially-paid or already-late cotisation still owes something — counts as pending
    // here too (EN_RETARD is exactly "still pending, past due", not a separate bucket).
    // membre.deletedAt: null mirrors /api/cotisations so this count never exceeds what the
    // cotisations list can actually show.
    prisma.cotisation.count({ where: { associationId, status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] }, year, membre: { deletedAt: null } } }),
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
    // Reste à percevoir — solde dû sur les cotisations pas encore soldées de l'année. Même
    // filtre de statuts que cotisationsEnAttente ci-dessus ; pas de prise en compte des
    // échéanciers (nextAmountDue) ici, ce chiffre n'a besoin que d'un ordre de grandeur pour
    // la carte Cotisations du dashboard, pas du prochain euro exact dû.
    prisma.cotisation.aggregate({
      where: { associationId, status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] }, year, membre: { deletedAt: null } },
      _sum: { amount: true, amountPaid: true },
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
      where: { associationId, ...evenementNotOverWhere(now) },
      orderBy: { date: "asc" },
      select: { id: true, title: true, date: true, endDate: true, location: true },
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
          where: { associationId, paidAt: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) }, refundedAt: null },
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
    // Total count behind the "Dons à encaisser" shortcut — donsEnAttente above is capped at
    // 5 for the recent-donations card and can't be reused as a badge count.
    canSeeDons
      ? prisma.don.count({
          where: { associationId, paidAt: null, paymentMethod: { in: ["ESPECES", "CHEQUE", "VIREMENT"] } },
        })
      : 0,
    // Carte "Mes tâches" (FORM-118, commentaire Emmanuelle) — en plus du total ouvert
    // (openCount, logique inchangée), la section "Aujourd'hui" a besoin du compte exact des
    // tâches du jour (todayCount, pour le libellé "Voir les X tâches du jour") et des 3
    // premières lignes à afficher (todayTasks). buildTacheWhere({ dueFilter: "today" }) est la
    // même fonction que la liste/les cards de résumé — aucune nouvelle logique de date ici.
    // La section "Prochaines échéances" (FORM-128, commentaire Emmanuelle) réutilise le même
    // membre : jusqu'à 3 tâches à partir de demain, triées par échéance croissante, sans
    // plafond de 7 jours (dueFilter "fromTomorrow" — distinct de "soon7").
    // "En retard" et le complément sans échéance (FORM-128, print du 2026-11-27, deuxième
    // commentaire Emmanuelle) : une tâche en retard ou sans date n'apparaissait dans aucune
    // des deux sections ci-dessus — visible seulement dans openCount, jamais dans une liste.
    // overdueTasks réutilise le même filtre "EN_RETARD" que le badge/la liste ailleurs dans
    // l'app (status.buildTacheWhere) ; noDueDateTasks ne comble que les places restantes de
    // "Prochaines échéances" quand les tâches datées n'en remplissent pas les 3.
    canSeeTaches
      ? prisma.membre.findFirst({ where: { userId: ctx.userId, associationId, deletedAt: null }, select: { id: true } })
          .then(async membre => {
            if (!membre) return null
            const todayWhere    = buildTacheWhere(associationId, { membreId: membre.id, dueFilter: "today" })
            const upcomingWhere = buildTacheWhere(associationId, { membreId: membre.id, dueFilter: "fromTomorrow" })
            const overdueWhere  = buildTacheWhere(associationId, { membreId: membre.id, status: "EN_RETARD" })
            const noDueDateWhere = buildTacheWhere(associationId, { membreId: membre.id, dueFilter: "noDueDate" })
            const [openCount, todayCount, todayTasks, upcomingDatedTasks, overdueCount, overdueTasks, noDueDateTasks] = await Promise.all([
              prisma.tache.count({ where: { associationId, status: { not: "TERMINEE" }, assignees: { some: { membreId: membre.id } } } }),
              prisma.tache.count({ where: todayWhere }),
              prisma.tache.findMany({ where: todayWhere, orderBy: { createdAt: "asc" }, take: 3, select: { id: true, titre: true, status: true } }),
              prisma.tache.findMany({ where: upcomingWhere, orderBy: { dueDate: "asc" }, take: 3, select: { id: true, titre: true, status: true, dueDate: true } }),
              prisma.tache.count({ where: overdueWhere }),
              prisma.tache.findMany({ where: overdueWhere, orderBy: { dueDate: "asc" }, take: 3, select: { id: true, titre: true, status: true, dueDate: true } }),
              prisma.tache.findMany({ where: noDueDateWhere, orderBy: { createdAt: "asc" }, take: 3, select: { id: true, titre: true, status: true, dueDate: true } }),
            ])
            // Les tâches datées remplissent la section en premier (triées par échéance) ; le
            // reste sans date ne vient que boucher les places restantes, jusqu'à 3 au total.
            const upcomingTasks = [...upcomingDatedTasks, ...noDueDateTasks].slice(0, 3)
            return { openCount, todayCount, todayTasks, upcomingTasks, overdueCount, overdueTasks, membreId: membre.id }
          })
      : Promise.resolve(null),
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
  // Clamped to 0: an overpayment on an individual pending cotisation (duplicate payment, a
  // refund not yet reflected) could otherwise push this negative — "-5,00 € restant à
  // percevoir" reads as nonsensical on a dashboard summary card.
  const cotisationsResteAPercevoir = Math.max(0, Number(cotisationsRestantes._sum.amount ?? 0) - Number(cotisationsRestantes._sum.amountPaid ?? 0))

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
    membresTotal,
    evenementsMois,
    cotisationsEnAttente,
    cotisationsEncaissees,
    cotisationsResteAPercevoir,
    // null (not 0) for a user without Comptabilité, like donsRecus below.
    solde: canSeeBalance ? solde : null,
    donsRecus,
    donsRecents,
    // null (not 0) for a role that can't see dons, mirroring donsRecus above.
    donsEnAttenteCount: canSeeDons ? donsEnAttenteCount : null,
    prochainEvenement: prochainEvenement && {
      ...prochainEvenement,
      // evenementNotOverWhere already guarantees this event hasn't ended — so "started" is
      // enough to mean "en cours" without re-checking the end bound.
      enCours: prochainEvenement.date <= now,
    },
    ventesRecentes,
    materielEnRetardCount,
    materielEmpruntsListe: materielEmpruntsListe.map(l => ({
      id:               l.id,
      materialName:     l.material.name,
      borrowerName:     l.membre ? `${l.membre.firstName} ${l.membre.lastName}` : (l.borrowerName ?? "—"),
      expectedReturnAt: l.expectedReturnAt,
      isOverdue:        !!l.expectedReturnAt && l.expectedReturnAt < now,
    })),
    // null = widget hidden, either no "taches" read access or no linked Membre (pure staff
    // account — nothing can ever be assigned to them). See comment on canSeeTaches above.
    mesTaches: mesTachesRaw,
  })
}, { area: "dashboard" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

// Neutralize CSV/formula injection — several of these fields (don/participation/commande
// guest info) come from public, unauthenticated forms. Same helper as the events export.
function sanitizeCell(value: string | null | undefined): string {
  if (!value) return ""
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const fmtDate = (d: Date | null | undefined) => (d ? format(d, "yyyy-MM-dd HH:mm") : "")

// Lets an association suspended for repeated failed payments pull everything out before
// deciding to reactivate or cancel definitively — the standby screen's one non-billing action.
//
// Covers every entity that's meaningfully "the association's data" — membres, cotisations,
// dons, billets, boutique, actualités, sondages (+ réponses), réunions, matériel (+ prêts)
// and the finance ledger. BankReconciliation is skipped on purpose: it's internal matching
// metadata between BankTransaction/Income/Expense, not source data, and is fully derivable
// from the three sheets that are included.
//
// Builds the whole workbook synchronously in memory; fine at this app's current scale, but
// a large association could hit the serverless function's time/memory limits. Move to a
// streamed/async export if that becomes a real problem.
export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const [
    membres, cotisations, dons, participations, commandes,
    actualites, sondages, reponses, meetings, materials, loans,
    incomes, expenses, bankAccounts, bankTransactions,
  ] = await Promise.all([
    prisma.membre.findMany({
      where:   { associationId, deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.cotisation.findMany({
      where:   { associationId },
      include: { membre: { select: { firstName: true, lastName: true } } },
      orderBy: [{ year: "desc" }],
    }),
    prisma.don.findMany({
      where:   { associationId },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.participation.findMany({
      where:   { evenement: { associationId } },
      include: { evenement: { select: { title: true, date: true } } },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.boutiqueCommande.findMany({
      where:   { associationId },
      include: { membre: { select: { firstName: true, lastName: true } }, items: { include: { produit: { select: { name: true } }, variante: { select: { label: true } } } } },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.actualite.findMany({
      where:   { associationId },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.sondage.findMany({
      where:   { associationId },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.sondageReponse.findMany({
      where:   { sondage: { associationId } },
      include: {
        sondage: { select: { title: true, anonymous: true } },
        membre:  { select: { firstName: true, lastName: true } },
        items:   { include: { question: { select: { label: true } } } },
      },
      orderBy: [{ submittedAt: "desc" }],
    }),
    prisma.meeting.findMany({
      where:   { associationId },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.material.findMany({
      where:   { associationId },
      orderBy: [{ name: "asc" }],
    }),
    prisma.materialLoan.findMany({
      where:   { material: { associationId } },
      include: { material: { select: { name: true } } },
      orderBy: [{ borrowedAt: "desc" }],
    }),
    prisma.income.findMany({
      where:   { associationId },
      include: { category: { select: { name: true } } },
      orderBy: [{ date: "desc" }],
    }),
    prisma.expense.findMany({
      where:   { associationId },
      include: { category: { select: { name: true } } },
      orderBy: [{ date: "desc" }],
    }),
    prisma.bankAccount.findMany({
      where:   { associationId },
      orderBy: [{ bankName: "asc" }],
    }),
    prisma.bankTransaction.findMany({
      where:   { associationId },
      include: { bankAccount: { select: { accountName: true } } },
      orderBy: [{ transactionDate: "desc" }],
    }),
  ])

  const wb = utils.book_new()

  utils.book_append_sheet(wb, utils.json_to_sheet(membres.map(m => ({
    Nom:      sanitizeCell(m.lastName),
    Prénom:   sanitizeCell(m.firstName),
    Email:    sanitizeCell(m.email),
    Téléphone: sanitizeCell(m.phone),
    Statut:   m.status,
    "Adhésion depuis": fmtDate(m.joinedAt),
  }))), "Membres")

  utils.book_append_sheet(wb, utils.json_to_sheet(cotisations.map(c => ({
    Nom:      sanitizeCell(c.membre.lastName),
    Prénom:   sanitizeCell(c.membre.firstName),
    Année:    c.year,
    Montant:  Number(c.amount),
    Statut:   c.status,
    "Payé le": fmtDate(c.paidAt),
  }))), "Cotisations")

  utils.book_append_sheet(wb, utils.json_to_sheet(dons.map(d => ({
    Type:     d.donorType,
    Nom:      sanitizeCell(d.donorType === "COMPANY" ? (d.companyName ?? d.firstName) : `${d.firstName} ${d.lastName}`),
    Email:    sanitizeCell(d.email),
    Montant:  Number(d.amount),
    "Payé le": fmtDate(d.paidAt),
    "N° reçu": sanitizeCell(d.receiptNumber),
  }))), "Dons")

  utils.book_append_sheet(wb, utils.json_to_sheet(participations.map(p => ({
    Événement: sanitizeCell(p.evenement.title),
    Date:      fmtDate(p.evenement.date),
    Nom:       sanitizeCell(p.lastName),
    Prénom:    sanitizeCell(p.firstName),
    Email:     sanitizeCell(p.email),
    Présent:   p.present ? "Oui" : "Non",
    Montant:   p.amount != null ? Number(p.amount) : "",
    "Payé le": fmtDate(p.ticketPaidAt),
  }))), "Billets")

  utils.book_append_sheet(wb, utils.json_to_sheet(commandes.map(c => ({
    Client:  sanitizeCell(c.membre ? `${c.membre.firstName} ${c.membre.lastName}` : c.guestName),
    Email:   sanitizeCell(c.guestEmail),
    Statut:  c.status,
    Articles: c.items.map(i => `${i.produit.name} (${i.variante.label}) x${i.quantity}`).join(", "),
    Montant: c.totalAmount / 100,
    "Passée le": fmtDate(c.createdAt),
  }))), "Commandes boutique")

  utils.book_append_sheet(wb, utils.json_to_sheet(actualites.map(a => ({
    Titre:      sanitizeCell(a.title),
    Contenu:    sanitizeCell(a.content),
    Épinglée:   a.pinned ? "Oui" : "Non",
    "Publiée le": fmtDate(a.publishedAt),
    "Créée le":   fmtDate(a.createdAt),
  }))), "Actualités")

  utils.book_append_sheet(wb, utils.json_to_sheet(sondages.map(s => ({
    Titre:        sanitizeCell(s.title),
    Description:  sanitizeCell(s.description),
    Statut:       s.status,
    Anonyme:      s.anonymous ? "Oui" : "Non",
    "Date limite": fmtDate(s.deadline),
    "Créé le":     fmtDate(s.createdAt),
  }))), "Sondages")

  utils.book_append_sheet(wb, utils.json_to_sheet(reponses.map(r => ({
    Sondage:    sanitizeCell(r.sondage.title),
    Membre:     r.sondage.anonymous ? "(anonyme)" : sanitizeCell(r.membre ? `${r.membre.firstName} ${r.membre.lastName}` : ""),
    "Répondu le": fmtDate(r.submittedAt),
    Réponses:   r.items.map(i => `${i.question.label}: ${i.value ?? ""}`).join(" | "),
  }))), "Réponses sondages")

  utils.book_append_sheet(wb, utils.json_to_sheet(meetings.map(m => ({
    Titre:        sanitizeCell(m.title),
    Description:  sanitizeCell(m.description),
    Statut:       m.status,
    "Prévue le":  fmtDate(m.scheduledAt),
    "Débutée le": fmtDate(m.startedAt),
    "Terminée le": fmtDate(m.endedAt),
    Résumé:       sanitizeCell(m.summary),
    Transcription: sanitizeCell(m.transcript),
  }))), "Réunions")

  utils.book_append_sheet(wb, utils.json_to_sheet(materials.map(m => ({
    Nom:      sanitizeCell(m.name),
    Catégorie: sanitizeCell(m.category),
    "N° série": sanitizeCell(m.serialNumber),
    Quantité: m.quantity,
    Statut:   m.status,
    Lieu:     sanitizeCell(m.location),
    "Acheté le": fmtDate(m.purchaseDate),
    "Prix d'achat": m.purchasePrice != null ? Number(m.purchasePrice) : "",
  }))), "Matériel")

  utils.book_append_sheet(wb, utils.json_to_sheet(loans.map(l => ({
    Matériel:   sanitizeCell(l.material.name),
    Emprunteur: sanitizeCell(l.borrowerName),
    Quantité:   l.quantity,
    Statut:     l.status,
    "Emprunté le":  fmtDate(l.borrowedAt),
    "Retour prévu": fmtDate(l.expectedReturnAt),
    "Rendu le":     fmtDate(l.returnedAt),
  }))), "Emprunts matériel")

  utils.book_append_sheet(wb, utils.json_to_sheet(incomes.map(i => ({
    Date:        fmtDate(i.date),
    Montant:     Number(i.amount),
    Catégorie:   sanitizeCell(i.category?.name),
    Description: sanitizeCell(i.description),
    Source:      i.source,
    Statut:      i.status,
    Référence:   sanitizeCell(i.reference),
  }))), "Recettes")

  utils.book_append_sheet(wb, utils.json_to_sheet(expenses.map(e => ({
    Date:        fmtDate(e.date),
    Montant:     Number(e.amount),
    Catégorie:   sanitizeCell(e.category?.name),
    Fournisseur: sanitizeCell(e.vendor),
    Description: sanitizeCell(e.description),
    Statut:      e.status,
  }))), "Dépenses")

  utils.book_append_sheet(wb, utils.json_to_sheet(bankAccounts.map(b => ({
    Banque:            sanitizeCell(b.bankName),
    Compte:            sanitizeCell(b.accountName),
    IBAN:              b.ibanLast4 ? `••••${b.ibanLast4}` : "",
    Devise:            b.currency,
    "Solde d'ouverture": Number(b.openingBalance),
    "Solde actuel":      Number(b.currentBalance),
    Actif:             b.isActive ? "Oui" : "Non",
  }))), "Comptes bancaires")

  utils.book_append_sheet(wb, utils.json_to_sheet(bankTransactions.map(t => ({
    Compte:      sanitizeCell(t.bankAccount.accountName),
    Date:        fmtDate(t.transactionDate),
    Libellé:     sanitizeCell(t.label),
    Montant:     Number(t.amount),
    Type:        t.type,
    Statut:      t.status,
    "Solde après": t.balanceAfter != null ? Number(t.balanceAfter) : "",
  }))), "Transactions bancaires")

  const buf  = write(wb, { type: "buffer", bookType: "xlsx" })
  const date = format(new Date(), "yyyy-MM-dd")

  return new NextResponse(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export_donnees_${date}.xlsx"`,
    },
  })
}, { roles: ADMINS, allowWhenSuspended: true })

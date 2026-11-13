import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureRecueUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { deleteFromR2 } from "@/lib/r2"
import { resolveManualFactureRecueStatus } from "@/lib/facture-recue-status"
import { reportError } from "@/lib/monitoring"

// Comptabilité area (FORM-34). The old GET/DELETE allowlists also let the Secrétaire in, although
// the sidebar never showed her this screen and every write was finance-only; she now has no access here.
const FACTURE_RECUE_FIELDS = ["number", "type", "issueDate", "amount", "status", "notes", "fournisseurId"] as const
const EPSILON = 0.01

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const factureRecue = await prisma.factureRecue.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: {
      fournisseur: { select: { id: true, companyName: true } },
      payments:    { orderBy: { paidAt: "desc" } },
      immobilisation: { select: { id: true } },
    },
  })

  if (!factureRecue) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })
  return NextResponse.json(factureRecue)
}, { area: "comptabilite", module: "fournisseurs" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.factureRecue.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = factureRecueUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // Mirrors Facture's own PATCH — a document with payments recorded needs an explicit
  // confirmation before any field (not just status) is touched (FORM-107 Fase 3).
  if ((existing.status === "PAYEE" || existing.status === "PARTIELLEMENT_PAYEE") && body?.force !== true) {
    return NextResponse.json({ error: "Ce document a des paiements enregistrés — confirmez la modification.", code: "REQUIRES_CONFIRMATION" }, { status: 409 })
  }

  const { fournisseurId, number, type, issueDate, amount, status, fileUrl, notes } = parsed.data

  // Only re-validate the fournisseur if it's actually changing — the edit form always
  // resubmits the current fournisseurId, and an archived (soft-deleted) fournisseur would
  // otherwise fail this check on every unrelated edit of a document still linked to it.
  if (fournisseurId && fournisseurId !== existing.fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }

  // Lowering amount below what's already been paid would break the invariant the payment
  // side enforces (amountPaid can never exceed amount) — same guard as Facture's own PATCH.
  if (amount !== undefined && amount < Number(existing.amountPaid) - EPSILON) {
    return NextResponse.json({
      error: `Le nouveau montant (${amount.toFixed(2)} €) est inférieur au montant déjà payé (${Number(existing.amountPaid).toFixed(2)} €) — ajustez ou supprimez des paiements d'abord.`,
    }, { status: 409 })
  }

  // A client-sent PAYEE/PARTIELLEMENT_PAYEE is only trustworthy if it still matches
  // amountPaid vs the (possibly just-changed) amount — see resolveManualFactureRecueStatus.
  const resolvedStatus = status !== undefined
    ? resolveManualFactureRecueStatus(status, Number(existing.amountPaid), amount ?? Number(existing.amount))
    : undefined

  const factureRecue = await prisma.factureRecue.update({
    where: { id },
    data: {
      ...(number        !== undefined ? { number: number || null } : {}),
      ...(type          !== undefined ? { type } : {}),
      ...(issueDate      !== undefined ? { issueDate: new Date(issueDate) } : {}),
      ...(amount        !== undefined ? { amount } : {}),
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(fileUrl       !== undefined ? { fileUrl } : {}),
      ...(notes         !== undefined ? { notes: notes || null } : {}),
      ...(fournisseurId !== undefined ? { fournisseurId: fournisseurId || null } : {}),
    },
    include: { fournisseur: { select: { id: true, companyName: true } }, payments: { orderBy: { paidAt: "desc" } } },
  })

  // A replaced document's old file is orphaned in R2 once the row points elsewhere —
  // clean it up the same way expense/boutique image replacement does.
  if (fileUrl !== undefined && fileUrl !== existing.fileUrl) {
    deleteFromR2(existing.fileUrl)
      .catch(error => reportError(error, { area: "storage", action: "factures-recues.delete-replaced-file", extra: { associationId, factureRecueId: id } }))
  }

  const changes = computeDiff(
    existing      as unknown as Record<string, unknown>,
    factureRecue  as unknown as Record<string, unknown>,
    FACTURE_RECUE_FIELDS,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_RECUE_UPDATED", entity: "FactureRecue", entityId: id, label: factureRecue.number ?? factureRecue.type, metadata: { changes } })
  }

  return NextResponse.json(factureRecue)
}, { area: "comptabilite", module: "fournisseurs" })

export const DELETE = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.factureRecue.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  let force = false
  try {
    const body = await req.json()
    force = body?.force === true
  } catch {
    // No body sent — force stays false
  }

  // PARTIELLEMENT_PAYEE needs the same confirmation as PAYEE — it also carries payments,
  // each with a linked Expense (+ possibly a bank reconciliation) or, for an Immobilisation-
  // linked document, a directly-posted JournalEntry, that the delete below wipes.
  if ((existing.status === "PAYEE" || existing.status === "PARTIELLEMENT_PAYEE") && !force) {
    return NextResponse.json({ error: "Ce document a des paiements enregistrés — les supprimer aussi ? Confirmez la suppression.", code: "REQUIRES_CONFIRMATION" }, { status: 409 })
  }

  class ImmobilisationHasDepreciationsError extends Error {}

  try {
    await prisma.$transaction(async (tx) => {
      await tx.factureRecue.update({ where: { id }, data: { deletedAt: new Date() } })

      // Soft-deleting the document doesn't touch its FactureRecuePayment rows (they're a real
      // paper trail), but each one may have an auto-created, linked Expense (the non-
      // Immobilisation path) — those must be reversed here or they'd be left orphaned and,
      // being linked, protected from ever being edited/deleted directly from Finanças.
      const linkedExpenses = await tx.expense.findMany({
        where:  { factureRecuePayment: { factureRecueId: id } },
        select: { id: true },
      })
      if (linkedExpenses.length > 0) {
        const expenseIds = linkedExpenses.map(e => e.id)
        const reconciliations = await tx.bankReconciliation.findMany({ where: { expenseId: { in: expenseIds } }, select: { bankTransactionId: true } })
        await tx.bankReconciliation.deleteMany({ where: { expenseId: { in: expenseIds } } })
        if (reconciliations.length > 0) {
          await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
        }
        await tx.expense.deleteMany({ where: { id: { in: expenseIds } } })
      }

      // Immobilisation-linked path: payments post straight to the journal (no Expense) — see
      // post-facture-recue-payment.ts. Those JournalEntry rows are the one deliberate exception
      // to "never deleted" (mirrors opening-balance.ts's own reasoning): deleting the document
      // itself compensates the whole acquisition being undone, not a correction to history.
      const immobilisation = await tx.immobilisation.findUnique({ where: { factureRecueId: id }, select: { id: true } })
      if (immobilisation) {
        const depreciationCount = await tx.immobilisationDepreciation.count({ where: { immobilisationId: immobilisation.id } })
        if (depreciationCount > 0) throw new ImmobilisationHasDepreciationsError()
        await tx.journalEntry.deleteMany({ where: { immobilisationId: immobilisation.id } })
        await tx.journalEntry.deleteMany({ where: { factureRecuePayment: { factureRecueId: id } } })
        await tx.immobilisation.delete({ where: { id: immobilisation.id } })
      }
    })
  } catch (err) {
    if (err instanceof ImmobilisationHasDepreciationsError) {
      return NextResponse.json({
        error: "Impossible de supprimer : des dotations aux amortissements ont déjà été comptabilisées pour l'immobilisation liée à ce document.",
      }, { status: 409 })
    }
    throw err
  }

  // No view or endpoint ever surfaces a soft-deleted FactureRecue again, so the file it
  // points to would otherwise sit orphaned in R2 forever — clean it up the same way a
  // fileUrl replacement does on PATCH.
  deleteFromR2(existing.fileUrl)
    .catch(error => reportError(error, { area: "storage", action: "factures-recues.delete-file", extra: { associationId, factureRecueId: id } }))

  await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_RECUE_DELETED", entity: "FactureRecue", entityId: id, label: existing.number ?? existing.type })

  return new NextResponse(null, { status: 204 })
}, { area: "comptabilite", module: "fournisseurs" })

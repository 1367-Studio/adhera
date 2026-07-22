import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { computeDocumentTotals, itemsUnchanged, exceedsMaxTotal, MAX_DOCUMENT_TOTAL } from "@/lib/devis-calc"
import { deriveFactureStatus, resolveManualStatus, type FactureStatus } from "@/lib/facture-status"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE  = ["ADMIN", "PRESIDENT", "TRESORIER"]

const FACTURE_FIELDS = ["status", "issueDate", "dueDate", "notes", "paymentTerms", "fournisseurId"] as const

function withDerivedStatus<T extends { status: string; dueDate: Date | string | null }>(f: T): T {
  return { ...f, status: deriveFactureStatus(f.status as FactureStatus, f.dueDate) }
}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const facture = await prisma.facture.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: {
      items:       { orderBy: { order: "asc" } },
      payments:    { orderBy: { paidAt: "desc" } },
      fournisseur: { select: { id: true, companyName: true, email: true } },
      devis:       { select: { id: true, number: true } },
    },
  })

  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })
  return NextResponse.json(withDerivedStatus(facture))
}, { module: "factures" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.facture.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } } },
  })
  if (!existing) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = factureUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  if (existing.status === "PAYEE" && body?.force !== true) {
    return NextResponse.json({ error: "Cette facture a été payée — confirmez la modification.", code: "REQUIRES_CONFIRMATION" }, { status: 409 })
  }

  const { fournisseurId, status, issueDate, dueDate, notes, paymentTerms, items } = parsed.data

  // Items on a Facture generated from a Devis conversion must stay identical to the
  // source Devis. The edit form always submits the full `items` array (disabled inputs
  // still carry their value in react-hook-form state), so checking mere presence would
  // reject every save on these facturas — compare by value and only block a real change.
  const itemsChanged = items !== undefined && !itemsUnchanged(existing.items, items)
  if (itemsChanged && existing.devisId) {
    return NextResponse.json({ error: "Les articles d'une facture issue d'un devis ne peuvent pas être modifiés." }, { status: 409 })
  }

  // Only re-validate the fournisseur if it's actually changing — the edit form always
  // resubmits the current fournisseurId, and an archived (soft-deleted) fournisseur would
  // otherwise fail this check on every unrelated edit of a facture still linked to it.
  if (fournisseurId && fournisseurId !== existing.fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }

  const totals = itemsChanged ? computeDocumentTotals(items!) : null
  if (totals && exceedsMaxTotal(totals)) {
    return NextResponse.json({ error: `Le total de la facture dépasse le maximum autorisé (${MAX_DOCUMENT_TOTAL.toLocaleString("fr-FR")} €)` }, { status: 422 })
  }

  // Editing items recomputes the total — if that pushes it below what's already been
  // paid, the invariant the overpayment check enforces on the payment side (amountPaid
  // can never exceed total) would break from this side instead. Block it the same way,
  // rather than silently letting the facture end up "paid more than its total".
  if (totals && totals.total < Number(existing.amountPaid) - 0.01) {
    return NextResponse.json({ error: `Le nouveau total (${totals.total.toFixed(2)} €) est inférieur au montant déjà payé (${Number(existing.amountPaid).toFixed(2)} €) — ajustez ou supprimez des paiements d'abord.` }, { status: 409 })
  }

  // A client-sent PAYEE/PARTIELLEMENT_PAYEE is only trustworthy if it still matches
  // amountPaid vs the (possibly just-recomputed) total — otherwise it's stale or a manual
  // override that would desync the badge from what's actually owed (see resolveManualStatus).
  const resolvedStatus = status !== undefined
    ? resolveManualStatus(status, Number(existing.amountPaid), totals?.total ?? Number(existing.total))
    : undefined

  const facture = await prisma.$transaction(async (tx) => {
    if (itemsChanged) {
      await tx.factureItem.deleteMany({ where: { factureId: id } })
    }

    return tx.facture.update({
      where: { id },
      data: {
        ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
        ...(issueDate      !== undefined ? { issueDate: new Date(issueDate) } : {}),
        ...(dueDate         !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(notes          !== undefined ? { notes: notes || null } : {}),
        ...(paymentTerms   !== undefined ? { paymentTerms: paymentTerms || null } : {}),
        ...(fournisseurId  !== undefined ? { fournisseurId: fournisseurId || null } : {}),
        ...(resolvedStatus === "EN_ATTENTE" && existing.status !== "EN_ATTENTE" ? { sentAt: new Date() } : {}),
        ...(totals ?? {}),
        ...(itemsChanged ? { items: { create: items!.map((item, order) => ({
          description: item.description,
          quantity:    item.quantity,
          unitPrice:   item.unitPrice,
          vatRate:     item.vatRate,
          discount:    item.discount,
          order,
        })) } } : {}),
      },
      include: { items: { orderBy: { order: "asc" } }, payments: true, fournisseur: { select: { id: true, companyName: true } } },
    })
  })

  const changes = computeDiff(
    existing as unknown as Record<string, unknown>,
    facture  as unknown as Record<string, unknown>,
    FACTURE_FIELDS,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_UPDATED", entity: "Facture", entityId: id, label: facture.number, metadata: { changes } })
  }

  return NextResponse.json(withDerivedStatus(facture))
}, { roles: FINANCE, module: "factures" })

export const DELETE = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.facture.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  let force = false
  try {
    const body = await req.json()
    force = body?.force === true
  } catch {
    // No body sent — force stays false
  }

  // PARTIELLEMENT_PAYEE needs the same confirmation as PAYEE — it also carries payments,
  // each with a linked Income (+ possibly a bank reconciliation) that the delete below wipes.
  if ((existing.status === "PAYEE" || existing.status === "PARTIELLEMENT_PAYEE") && !force) {
    return NextResponse.json({ error: "Cette facture a des paiements enregistrés — les supprimer aussi ? Confirmez la suppression.", code: "REQUIRES_CONFIRMATION" }, { status: 409 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.facture.update({ where: { id }, data: { deletedAt: new Date() } })

    // Soft-deleting the facture doesn't touch its FacturePayment rows (they're a real
    // paper trail), but each one may have an auto-created, linked Income — those must be
    // reversed here or they'd be left orphaned and, being linked, protected from ever
    // being edited/deleted directly from Finanças. Covers PARTIELLEMENT_PAYEE too, not
    // just PAYEE — a partial payment already created an Income the same way.
    const linkedIncomes = await tx.income.findMany({
      where:  { facturePayment: { factureId: id } },
      select: { id: true },
    })
    if (linkedIncomes.length > 0) {
      const incomeIds = linkedIncomes.map(i => i.id)
      const reconciliations = await tx.bankReconciliation.findMany({ where: { incomeId: { in: incomeIds } }, select: { bankTransactionId: true } })
      await tx.bankReconciliation.deleteMany({ where: { incomeId: { in: incomeIds } } })
      if (reconciliations.length > 0) {
        await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
      }
      await tx.income.deleteMany({ where: { id: { in: incomeIds } } })
    }
  })

  await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_DELETED", entity: "Facture", entityId: id, label: existing.number })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "factures" })

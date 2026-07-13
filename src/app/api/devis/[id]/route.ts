import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { devisUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { computeDocumentTotals, itemsUnchanged } from "@/lib/devis-calc"
import { deriveDevisStatus, type DevisStatus } from "@/lib/devis-status"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE  = ["ADMIN", "PRESIDENT", "TRESORIER"]

function withDerivedStatus<T extends { status: string; validUntil: Date | string | null }>(d: T): T {
  return { ...d, status: deriveDevisStatus(d.status as DevisStatus, d.validUntil) }
}

const DEVIS_FIELDS = ["status", "issueDate", "validUntil", "notes", "paymentTerms", "fournisseurId"] as const

// A status change into one of these is a distinct, traceable lifecycle event in its own
// right (see requirement: "Orçamento enviado", "Orçamento aceito") — logging it under the
// generic DEVIS_UPDATED action would bury it in the history as an unlabeled diff instead
// of a readable "Devis envoyé" / "Devis accepté" entry.
const STATUS_ACTION: Partial<Record<string, string>> = {
  ENVOYE:  "DEVIS_SENT",
  ACCEPTE: "DEVIS_ACCEPTED",
  REFUSE:  "DEVIS_REFUSED",
  EXPIRE:  "DEVIS_EXPIRED",
}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const devis = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: {
      items:       { orderBy: { order: "asc" } },
      fournisseur: { select: { id: true, companyName: true, email: true } },
      facture:     { select: { id: true, number: true } },
    },
  })

  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })
  return NextResponse.json(withDerivedStatus(devis))
}, { module: "devis" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } }, facture: { select: { id: true, number: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = devisUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { fournisseurId, status, issueDate, validUntil, notes, paymentTerms, items } = parsed.data

  // Once a Devis has been converted, its items are frozen — the Facture it produced is a
  // snapshot of them and never re-syncs. The edit form always submits the full `items`
  // array (disabled inputs still carry their value in react-hook-form state), so checking
  // mere presence would reject every save on a converted devis — compare by value and
  // only block a real change.
  const itemsChanged = items !== undefined && !itemsUnchanged(existing.items, items)
  if (itemsChanged && existing.facture) {
    return NextResponse.json({ error: `Ce devis a été converti en facture ${existing.facture.number} — les articles ne peuvent plus être modifiés.` }, { status: 409 })
  }

  if (fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }

  const totals = itemsChanged ? computeDocumentTotals(items!) : null

  const devis = await prisma.$transaction(async (tx) => {
    if (itemsChanged) {
      await tx.devisItem.deleteMany({ where: { devisId: id } })
    }

    return tx.devis.update({
      where: { id },
      data: {
        ...(status        !== undefined ? { status } : {}),
        ...(issueDate      !== undefined ? { issueDate: new Date(issueDate) } : {}),
        ...(validUntil     !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}),
        ...(notes          !== undefined ? { notes: notes || null } : {}),
        ...(paymentTerms   !== undefined ? { paymentTerms: paymentTerms || null } : {}),
        ...(fournisseurId  !== undefined ? { fournisseurId: fournisseurId || null } : {}),
        ...(status === "ENVOYE" && existing.status !== "ENVOYE" ? { sentAt: new Date() } : {}),
        ...(status && ["ACCEPTE", "REFUSE", "EXPIRE"].includes(status) && existing.status !== status ? { respondedAt: new Date() } : {}),
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
      include: { items: { orderBy: { order: "asc" } }, fournisseur: { select: { id: true, companyName: true } } },
    })
  })

  const changes = computeDiff(
    existing as unknown as Record<string, unknown>,
    devis    as unknown as Record<string, unknown>,
    DEVIS_FIELDS,
  )
  if (Object.keys(changes).length > 0) {
    const statusChangedTo = changes.status?.new
    const action = (statusChangedTo && STATUS_ACTION[statusChangedTo]) || "DEVIS_UPDATED"
    await writeActivityLog({ associationId, actorId: userId, action, entity: "Devis", entityId: id, label: devis.number, metadata: { changes } })
  }

  return NextResponse.json(withDerivedStatus(devis))
}, { roles: FINANCE, module: "devis" })

export const DELETE = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { facture: { select: { id: true, number: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })

  if (existing.facture) {
    return NextResponse.json({ error: `Ce devis a été converti en facture ${existing.facture.number} — supprimez la facture d'abord si nécessaire.` }, { status: 409 })
  }

  let force = false
  try {
    const body = await req.json()
    force = body?.force === true
  } catch {
    // No body sent — force stays false
  }

  if (existing.status === "ACCEPTE" && !force) {
    return NextResponse.json({ error: "Ce devis a été accepté — confirmez la suppression.", code: "REQUIRES_CONFIRMATION" }, { status: 409 })
  }

  await prisma.devis.update({ where: { id }, data: { deletedAt: new Date() } })

  await writeActivityLog({ associationId, actorId: userId, action: "DEVIS_DELETED", entity: "Devis", entityId: id, label: existing.number })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "devis" })

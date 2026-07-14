import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureRecueUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { deleteFromR2 } from "@/lib/r2"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE  = ["ADMIN", "PRESIDENT", "TRESORIER"]

const FACTURE_RECUE_FIELDS = ["number", "type", "issueDate", "amount", "status", "notes", "fournisseurId"] as const

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const factureRecue = await prisma.factureRecue.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { fournisseur: { select: { id: true, companyName: true } } },
  })

  if (!factureRecue) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })
  return NextResponse.json(factureRecue)
}, { module: "fournisseurs" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.factureRecue.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = factureRecueUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { fournisseurId, number, type, issueDate, amount, status, fileUrl, notes } = parsed.data

  // Only re-validate the fournisseur if it's actually changing — the edit form always
  // resubmits the current fournisseurId, and an archived (soft-deleted) fournisseur would
  // otherwise fail this check on every unrelated edit of a document still linked to it.
  if (fournisseurId && fournisseurId !== existing.fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }

  const factureRecue = await prisma.factureRecue.update({
    where: { id },
    data: {
      ...(number        !== undefined ? { number: number || null } : {}),
      ...(type          !== undefined ? { type } : {}),
      ...(issueDate      !== undefined ? { issueDate: new Date(issueDate) } : {}),
      ...(amount        !== undefined ? { amount } : {}),
      ...(status        !== undefined ? { status } : {}),
      ...(fileUrl       !== undefined ? { fileUrl } : {}),
      ...(notes         !== undefined ? { notes: notes || null } : {}),
      ...(fournisseurId !== undefined ? { fournisseurId: fournisseurId || null } : {}),
    },
    include: { fournisseur: { select: { id: true, companyName: true } } },
  })

  // A replaced document's old file is orphaned in R2 once the row points elsewhere —
  // clean it up the same way expense/boutique image replacement does.
  if (fileUrl !== undefined && fileUrl !== existing.fileUrl) {
    deleteFromR2(existing.fileUrl).catch(() => {})
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
}, { roles: FINANCE, module: "fournisseurs" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.factureRecue.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  await prisma.factureRecue.update({ where: { id }, data: { deletedAt: new Date() } })

  // No view or endpoint ever surfaces a soft-deleted FactureRecue again, so the file it
  // points to would otherwise sit orphaned in R2 forever — clean it up the same way a
  // fileUrl replacement does on PATCH.
  deleteFromR2(existing.fileUrl).catch(() => {})

  await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_RECUE_DELETED", entity: "FactureRecue", entityId: id, label: existing.number ?? existing.type })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "fournisseurs" })

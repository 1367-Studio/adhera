import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureRecueUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { deleteFromR2 } from "@/lib/r2"
import { factureRecueExpenseDescription } from "@/lib/facture-recue"

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

  // Any document type (facture, devis_recu, comprovante, contrat, autre) bridges to Expense
  // the same way once it's marked PAYEE — amount + status are what the ledger cares about,
  // not how the document was classified.
  const entersPaid = status !== undefined && status === "PAYEE" && existing.status !== "PAYEE"
  const leavesPaid = status !== undefined && status !== "PAYEE" && existing.status === "PAYEE"
  const staysPaid  = existing.status === "PAYEE" && !leavesPaid

  // Only treat a field as "changed" when its new value actually differs from what's stored —
  // the edit form always resubmits every field (see the fournisseurId re-validation comment
  // above), so a bare `!== undefined` check fired an Expense.updateMany on every single save
  // of a payée document, even one that only touched notes.
  const amountChanged      = amount        !== undefined && Number(amount) !== Number(existing.amount)
  const fournisseurChanged = fournisseurId !== undefined && (fournisseurId || null) !== existing.fournisseurId
  const issueDateChanged   = issueDate     !== undefined && new Date(issueDate).getTime() !== existing.issueDate.getTime()
  const numberChanged      = number        !== undefined && (number || null) !== existing.number
  const typeChanged        = type          !== undefined && type !== existing.type

  let factureRecue
  try {
    factureRecue = await prisma.$transaction(async (tx) => {
      const updated = await tx.factureRecue.update({
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

      if (entersPaid) {
        await tx.expense.create({
          data: {
            associationId,
            factureRecueId: id,
            amount:      updated.amount,
            status:      "VALIDATED",
            date:        updated.issueDate,
            vendor:      updated.fournisseur?.companyName ?? null,
            description: factureRecueExpenseDescription(updated),
          },
        })
      } else if (leavesPaid) {
        // Mirrors the Facture-payment reversal: drop any bank reconciliation for the linked
        // Expense (resetting that transaction to UNMATCHED) before deleting the Expense itself.
        const linkedExpense = await tx.expense.findUnique({ where: { factureRecueId: id }, select: { id: true } })
        if (linkedExpense) {
          const reconciliations = await tx.bankReconciliation.findMany({ where: { expenseId: linkedExpense.id }, select: { bankTransactionId: true } })
          await tx.bankReconciliation.deleteMany({ where: { expenseId: linkedExpense.id } })
          if (reconciliations.length > 0) {
            await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
          }
          await tx.expense.delete({ where: { id: linkedExpense.id } })
        }
      } else if (staysPaid && (amountChanged || fournisseurChanged || issueDateChanged || numberChanged || typeChanged)) {
        // Keeps the linked Expense in step with any edit made while the document stays payée
        // — previously only amount/vendor were synced, silently leaving the Expense's date
        // and description stale after an issueDate/number/type correction.
        await tx.expense.updateMany({
          where: { factureRecueId: id },
          data: {
            ...(amountChanged      ? { amount: updated.amount } : {}),
            ...(fournisseurChanged ? { vendor: updated.fournisseur?.companyName ?? null } : {}),
            ...(issueDateChanged   ? { date: updated.issueDate } : {}),
            ...((numberChanged || typeChanged) ? { description: factureRecueExpenseDescription(updated) } : {}),
          },
        })
      }

      return updated
    })
  } catch (err) {
    // P2002 = another request already flipped this same document to PAYEE and created its
    // Expense (factureRecueId is @unique) between our read of `existing` and this write —
    // e.g. a double-click, or two staff members at once.
    if (entersPaid && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Ce document vient d'être marqué payé par ailleurs — rechargez la page." }, { status: 409 })
    }
    throw err
  }

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

  await prisma.$transaction(async (tx) => {
    await tx.factureRecue.update({ where: { id }, data: { deletedAt: new Date() } })

    // A payée document being deleted must also take its auto-created Expense with it —
    // otherwise that row is left orphaned and, since it's linked, protected from ever
    // being edited/deleted directly from Finanças (see finances/expenses/[id]/route.ts).
    if (existing.status === "PAYEE") {
      const linkedExpense = await tx.expense.findUnique({ where: { factureRecueId: id }, select: { id: true } })
      if (linkedExpense) {
        const reconciliations = await tx.bankReconciliation.findMany({ where: { expenseId: linkedExpense.id }, select: { bankTransactionId: true } })
        await tx.bankReconciliation.deleteMany({ where: { expenseId: linkedExpense.id } })
        if (reconciliations.length > 0) {
          await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
        }
        await tx.expense.delete({ where: { id: linkedExpense.id } })
      }
    }
  })

  // No view or endpoint ever surfaces a soft-deleted FactureRecue again, so the file it
  // points to would otherwise sit orphaned in R2 forever — clean it up the same way a
  // fileUrl replacement does on PATCH.
  deleteFromR2(existing.fileUrl).catch(() => {})

  await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_RECUE_DELETED", entity: "FactureRecue", entityId: id, label: existing.number ?? existing.type })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "fournisseurs" })

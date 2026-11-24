// src/app/api/factures-recues/[id]/payments/[paymentId]/route.ts
// Mirrors factures/[id]/paiements/[paymentId]/route.ts (Facture/emitted side) — see
// FORM-107 Fase 3.
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { closedExerciceGuard } from "@/lib/finance/exercice"
import { resolveManualFactureRecueStatus } from "@/lib/facture-recue-status"
import { reverseExpenseJournalEntry } from "@/lib/finance/journal/post-income-expense"
import { bankTransactionIdsToRelease } from "@/lib/finance/release-bank-transaction"

const EPSILON = 0.01

export const DELETE = withAdminAuth<{ id: string; paymentId: string }>(async (_req, ctx, { id, paymentId }) => {
  const { associationId, userId } = ctx

  const factureRecue = await prisma.factureRecue.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!factureRecue) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const payment = await prisma.factureRecuePayment.findFirst({ where: { id: paymentId, factureRecueId: id } })
  if (!payment) return NextResponse.json({ error: "Paiement introuvable" }, { status: 404 })

  // Captured before the transaction — the Expense below is hard-deleted inside it, so there's
  // nothing left to look up by afterward (same ordering constraint as every other hard-delete
  // call site, see cotisations/[id]/route.ts's own comment). A payment that settles a payable
  // directly (Immobilisation's 404000, or a plain categorized invoice's 401000 under ACCRUAL
  // regime — FORM-117) never created an Expense at all — its JournalEntry is deleted directly
  // instead below, a deliberate exception, not something to reverse. Branching on "does a
  // linked Expense exist" rather than on factureRecue.immobilisation covers both payable shapes
  // uniformly, instead of only the Immobilisation one.
  const linkedExpensePreview = await prisma.expense.findUnique({
    where:  { factureRecuePaymentId: paymentId },
    select: { id: true, exercice: { select: { status: true } } },
  })
  const linkedExpenseToReverse = linkedExpensePreview ? { id: linkedExpensePreview.id } : null

  if (linkedExpensePreview) {
    const guard = await closedExerciceGuard(linkedExpensePreview.exercice?.status)
    if (guard) return guard
  } else {
    // The settlement entry's own exercice, not the document's.
    const entry = await prisma.journalEntry.findUnique({
      where:  { idempotencyKey: `facture-recue-payment:${paymentId}` },
      select: { exercice: { select: { status: true } } },
    })
    const guard = await closedExerciceGuard(entry?.exercice?.status)
    if (guard) return guard
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (!linkedExpenseToReverse) {
        // Same deliberate exception as opening-balance.ts's own doc comment — deleting a
        // specific payment compensates recording it being undone, not a correction of history.
        await tx.journalEntry.deleteMany({ where: { idempotencyKey: `facture-recue-payment:${paymentId}` } })
      } else {
        // Mirrors the Facture-payment reversal: drop any bank reconciliation for the linked
        // Expense (resetting that transaction to UNMATCHED) before deleting the Expense itself.
        const reconciliations = await tx.bankReconciliation.findMany({ where: { expenseId: linkedExpenseToReverse.id }, select: { bankTransactionId: true } })
        await tx.bankReconciliation.deleteMany({ where: { expenseId: linkedExpenseToReverse.id } })
        // Only release a transaction with NO other reconciliation row left — a grouped
        // reconciliation (FORM-116 block 8) can still be legitimately matched via sibling rows.
        const toRelease = await bankTransactionIdsToRelease(tx, reconciliations.map(r => r.bankTransactionId), [])
        if (toRelease.length > 0) {
          await tx.bankTransaction.updateMany({ where: { id: { in: toRelease } }, data: { status: "UNMATCHED" } })
        }
        await tx.expense.delete({ where: { id: linkedExpenseToReverse.id } })
      }

      await tx.factureRecuePayment.delete({ where: { id: paymentId } })

      const result = await tx.factureRecue.update({
        where: { id },
        data:  { amountPaid: { decrement: payment.amount } },
      })

      const amountPaid = Number(result.amountPaid)
      const total       = Number(result.amount)
      // Only reconcile status when it was actually payment-driven — a manually set EN_LITIGE/
      // ANNULEE stays untouched by removing an unrelated payment record.
      const newStatus =
        result.status === "PAYEE" || result.status === "PARTIELLEMENT_PAYEE"
          ? resolveManualFactureRecueStatus(amountPaid >= total - EPSILON ? "PAYEE" : "PARTIELLEMENT_PAYEE", amountPaid, total)
          : result.status

      return tx.factureRecue.update({
        where: { id },
        data:  { status: newStatus },
        include: { fournisseur: { select: { id: true, companyName: true } }, payments: { orderBy: { paidAt: "desc" } } },
      })
    })

    if (linkedExpenseToReverse) await reverseExpenseJournalEntry(linkedExpenseToReverse.id)

    await writeActivityLog({
      associationId, actorId: userId, action: "FACTURE_RECUE_PAYMENT_REMOVED", entity: "FactureRecue", entityId: id, label: updated.number ?? updated.type,
      metadata: { amount: Number(payment.amount), method: payment.method },
    })

    return NextResponse.json(updated)
  } catch (err) {
    // P2025 = record already gone — two tabs / a double-click racing the delete past the
    // findFirst check above.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Ce paiement a déjà été supprimé" }, { status: 404 })
    }
    throw err
  }
}, { area: "comptabilite", module: "fournisseurs" })

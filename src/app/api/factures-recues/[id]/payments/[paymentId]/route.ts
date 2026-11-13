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

const EPSILON = 0.01

export const DELETE = withAdminAuth<{ id: string; paymentId: string }>(async (_req, ctx, { id, paymentId }) => {
  const { associationId, userId } = ctx

  const factureRecue = await prisma.factureRecue.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { immobilisation: { select: { id: true } } },
  })
  if (!factureRecue) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })

  const payment = await prisma.factureRecuePayment.findFirst({ where: { id: paymentId, factureRecueId: id } })
  if (!payment) return NextResponse.json({ error: "Paiement introuvable" }, { status: 404 })

  if (factureRecue.immobilisation) {
    // The settlement entry's own exercice, not the document's — mirrors the Expense-based
    // path's guard (that one reads the linked Expense's exercice).
    const entry = await prisma.journalEntry.findUnique({
      where:  { idempotencyKey: `facture-recue-payment:${paymentId}` },
      select: { exercice: { select: { status: true } } },
    })
    const guard = closedExerciceGuard(entry?.exercice?.status)
    if (guard) return guard
  } else {
    const linkedExpensePreview = await prisma.expense.findUnique({
      where:  { factureRecuePaymentId: paymentId },
      select: { exercice: { select: { status: true } } },
    })
    const guard = closedExerciceGuard(linkedExpensePreview?.exercice?.status)
    if (guard) return guard
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (factureRecue.immobilisation) {
        // Same deliberate exception as opening-balance.ts's own doc comment — deleting a
        // specific payment compensates recording it being undone, not a correction of history.
        await tx.journalEntry.deleteMany({ where: { idempotencyKey: `facture-recue-payment:${paymentId}` } })
      } else {
        // Mirrors the Facture-payment reversal: drop any bank reconciliation for the linked
        // Expense (resetting that transaction to UNMATCHED) before deleting the Expense itself.
        const linkedExpense = await tx.expense.findUnique({ where: { factureRecuePaymentId: paymentId }, select: { id: true } })
        if (linkedExpense) {
          const reconciliations = await tx.bankReconciliation.findMany({ where: { expenseId: linkedExpense.id }, select: { bankTransactionId: true } })
          await tx.bankReconciliation.deleteMany({ where: { expenseId: linkedExpense.id } })
          if (reconciliations.length > 0) {
            await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
          }
          await tx.expense.delete({ where: { id: linkedExpense.id } })
        }
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

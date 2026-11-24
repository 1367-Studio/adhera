import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { closedExerciceGuard } from "@/lib/finance/exercice"
import { reverseIncomeJournalEntry } from "@/lib/finance/journal/post-income-expense"
import { bankTransactionIdsToRelease } from "@/lib/finance/release-bank-transaction"

const EPSILON = 0.01

export const DELETE = withAdminAuth<{ id: string; paymentId: string }>(async (_req, ctx, { id, paymentId }) => {
  const { associationId, userId } = ctx

  const facture = await prisma.facture.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  const payment = await prisma.facturePayment.findFirst({ where: { id: paymentId, factureId: id } })
  if (!payment) return NextResponse.json({ error: "Paiement introuvable" }, { status: 404 })

  const linkedIncomePreview = await prisma.income.findUnique({
    where:  { facturePaymentId: paymentId },
    select: { exercice: { select: { status: true } } },
  })
  const closedGuard = await closedExerciceGuard(linkedIncomePreview?.exercice?.status)
  if (closedGuard) return closedGuard

  // Captured before the transaction — the Income below is hard-deleted inside it, so there's
  // nothing left to look up by afterward (same ordering constraint as every other hard-delete
  // call site, see cotisations/[id]/route.ts's own comment).
  const linkedIncomeToReverse = await prisma.income.findUnique({ where: { facturePaymentId: paymentId }, select: { id: true } })

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Mirrors the event-ticket cancel-payment/cancel-ticket pattern: drop any bank
      // reconciliation pointing at the linked Income (and reset that bank transaction to
      // UNMATCHED) before deleting the Income itself, so nothing is left reconciled
      // against a row that no longer exists.
      if (linkedIncomeToReverse) {
        const reconciliations = await tx.bankReconciliation.findMany({ where: { incomeId: linkedIncomeToReverse.id }, select: { bankTransactionId: true } })
        await tx.bankReconciliation.deleteMany({ where: { incomeId: linkedIncomeToReverse.id } })
        // Only release a transaction with NO other reconciliation row left — a grouped
        // reconciliation (FORM-116 block 8) can still be legitimately matched via sibling rows.
        const toRelease = await bankTransactionIdsToRelease(tx, reconciliations.map(r => r.bankTransactionId), [])
        if (toRelease.length > 0) {
          await tx.bankTransaction.updateMany({ where: { id: { in: toRelease } }, data: { status: "UNMATCHED" } })
        }
        await tx.income.delete({ where: { id: linkedIncomeToReverse.id } })
      }

      await tx.facturePayment.delete({ where: { id: paymentId } })

      const result = await tx.facture.update({
        where: { id },
        data:  { amountPaid: { decrement: payment.amount } },
      })

      const amountPaid = Number(result.amountPaid)
      const total       = Number(result.total)
      // Only reconcile status when it was actually payment-driven — a manually set BROUILLON/
      // EN_ATTENTE/ANNULEE stays untouched by removing an unrelated payment record.
      const newStatus =
        result.status === "PAYEE" || result.status === "PARTIELLEMENT_PAYEE"
          ? (amountPaid <= EPSILON ? "EN_ATTENTE" : amountPaid >= total - EPSILON ? "PAYEE" : "PARTIELLEMENT_PAYEE")
          : result.status

      return tx.facture.update({
        where: { id },
        data:  { status: newStatus },
        include: { items: { orderBy: { order: "asc" } }, payments: { orderBy: { paidAt: "desc" } }, fournisseur: { select: { id: true, companyName: true } } },
      })
    })

    if (linkedIncomeToReverse) await reverseIncomeJournalEntry(linkedIncomeToReverse.id)

    await writeActivityLog({
      associationId, actorId: userId, action: "FACTURE_PAYMENT_REMOVED", entity: "Facture", entityId: id, label: updated.number,
      metadata: { amount: Number(payment.amount), method: payment.method },
    })

    return NextResponse.json(updated)
  } catch (err) {
    // P2025 = record already gone — two tabs / a double-click racing the delete past the
    // findFirst check above. Not an error worth a 500 for; the payment is gone either way.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Ce paiement a déjà été supprimé" }, { status: 404 })
    }
    throw err
  }
}, { area: "comptabilite", module: "factures" })

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]
const EPSILON = 0.01

export const DELETE = withAdminAuth<{ id: string; paymentId: string }>(async (_req, ctx, { id, paymentId }) => {
  const { associationId, userId } = ctx

  const facture = await prisma.facture.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  const payment = await prisma.facturePayment.findFirst({ where: { id: paymentId, factureId: id } })
  if (!payment) return NextResponse.json({ error: "Paiement introuvable" }, { status: 404 })

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Mirrors the event-ticket cancel-payment/cancel-ticket pattern: drop any bank
      // reconciliation pointing at the linked Income (and reset that bank transaction to
      // UNMATCHED) before deleting the Income itself, so nothing is left reconciled
      // against a row that no longer exists.
      const linkedIncome = await tx.income.findUnique({ where: { facturePaymentId: paymentId }, select: { id: true } })
      if (linkedIncome) {
        const reconciliations = await tx.bankReconciliation.findMany({ where: { incomeId: linkedIncome.id }, select: { bankTransactionId: true } })
        await tx.bankReconciliation.deleteMany({ where: { incomeId: linkedIncome.id } })
        if (reconciliations.length > 0) {
          await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
        }
        await tx.income.delete({ where: { id: linkedIncome.id } })
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
}, { roles: FINANCE, module: "factures" })

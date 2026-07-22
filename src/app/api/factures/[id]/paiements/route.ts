import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { facturePaymentSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// A tiny epsilon guards against float/Decimal rounding noise (e.g. 19.99 + 0.01
// landing on 20.000000000000004) without letting a real overpayment through.
const EPSILON = 0.01

class OverpaymentError extends Error {
  constructor(public remaining: number) { super("overpayment") }
}

function incomeDescription(existing: { number: string; materialLoan: { material: { name: string } } | null; fournisseur: { companyName: string } | null }): string {
  if (existing.materialLoan) return `Prêt matériel — ${existing.materialLoan.material.name} (Facture ${existing.number})`
  if (existing.fournisseur)  return `Facture ${existing.number} — ${existing.fournisseur.companyName}`
  return `Facture ${existing.number}`
}

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.facture.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { materialLoan: { include: { material: true } }, fournisseur: { select: { companyName: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })
  if (existing.status === "ANNULEE") {
    return NextResponse.json({ error: "Cette facture est annulée" }, { status: 409 })
  }
  if (existing.status === "BROUILLON") {
    return NextResponse.json({ error: "Cette facture est encore en brouillon — passez-la en attente avant d'enregistrer un paiement" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = facturePaymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { amount, method, paidAt, note } = parsed.data

  try {
    // amountPaid is updated via an atomic `increment` inside the transaction (not read-then-
    // write with the `existing` fetched above) so two payments recorded close together — e.g.
    // a double-click, or two staff members at once — can't lose one via a stale read. The
    // overpayment check runs *after* the increment, against its result, rather than against
    // a value read before the transaction started — that way it still catches the case where
    // two concurrent payments would together exceed the total, since Postgres serializes the
    // two increments and whichever one pushes amountPaid past the total gets rolled back here.
    const facture = await prisma.$transaction(async (tx) => {
      const paymentDate = paidAt ? new Date(paidAt) : new Date()

      const payment = await tx.facturePayment.create({
        data: {
          factureId: id,
          amount,
          method,
          paidAt: paymentDate,
          note:   note || null,
        },
      })

      const updated = await tx.facture.update({
        where: { id },
        data:  { amountPaid: { increment: amount } },
      })

      const amountPaid = Number(updated.amountPaid)
      const total       = Number(updated.total)
      if (amountPaid > total + EPSILON) {
        throw new OverpaymentError(Math.max(0, total - (amountPaid - amount)))
      }
      const newStatus = amountPaid >= total - EPSILON ? "PAYEE" : amountPaid > 0 ? "PARTIELLEMENT_PAYEE" : updated.status

      // Every Facture payment (devis-billed, fournisseur-billed, or material-loan-billed)
      // feeds Income the same way. facturePaymentId is the reversible link that DELETE
      // .../paiements/[paymentId] uses to remove this row again if the payment is deleted.
      await tx.income.create({
        data: {
          associationId,
          memberId:         existing.materialLoan?.membreId ?? null,
          facturePaymentId: payment.id,
          amount,
          categoryId:    existing.materialLoan?.material.categoryId ?? null,
          paymentMethod: method,
          date:          paymentDate,
          description:   incomeDescription(existing),
          source:        "MANUAL",
          status:        "PAID",
          reference:     existing.number,
        },
      })

      return tx.facture.update({
        where: { id },
        data:  { status: newStatus },
        include: { items: { orderBy: { order: "asc" } }, payments: { orderBy: { paidAt: "desc" } }, fournisseur: { select: { id: true, companyName: true } } },
      })
    })

    await writeActivityLog({
      associationId, actorId: userId, action: "FACTURE_PAYMENT_ADDED", entity: "Facture", entityId: id, label: facture.number,
      metadata: { amount, method },
    })

    return NextResponse.json(facture, { status: 201 })
  } catch (err) {
    if (err instanceof OverpaymentError) {
      return NextResponse.json({ error: `Le montant dépasse le solde restant (${err.remaining.toFixed(2)} €)` }, { status: 422 })
    }
    throw err
  }
}, { roles: FINANCE, module: "factures" })

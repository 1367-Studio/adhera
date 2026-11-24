// src/app/api/factures-recues/[id]/payments/route.ts
// Mirrors factures/[id]/paiements/route.ts (Facture/emitted side) — see FORM-107 Fase 3.
import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureRecuePaymentSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import { factureRecueExpenseDescription } from "@/lib/facture-recue"
import { resolveManualFactureRecueStatus } from "@/lib/facture-recue-status"
import { postFactureRecuePaymentToJournal } from "@/lib/finance/journal/post-facture-recue-payment"

// A tiny epsilon guards against float/Decimal rounding noise without letting a real
// overpayment through — same role as facture/[id]/paiements/route.ts's own EPSILON.
const EPSILON = 0.01

class OverpaymentError extends Error {
  constructor(public remaining: number) { super("overpayment") }
}

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.factureRecue.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { fournisseur: { select: { companyName: true } }, immobilisation: { select: { id: true } }, expense: { select: { id: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Document introuvable" }, { status: 404 })
  if (existing.status === "ANNULEE") {
    return NextResponse.json({ error: "Ce document est annulé" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = factureRecuePaymentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { amount, method, paidAt, note } = parsed.data
  const paymentDate = paidAt ? new Date(paidAt) : new Date()

  const exercice = await resolveExerciceForDate(associationId, paymentDate)
  const guard = await closedExerciceGuard(exercice?.status)
  if (guard) return guard

  // FORM-117 — gated on whether the accrual charge was actually posted (existing.expense),
  // never re-derived from the association's CURRENT regime: regime is editable at any time,
  // and re-deriving from it here would double-recognize the charge (or silently settle a
  // payable that was never debited) for an invoice whose charge was posted — or deliberately
  // deferred to the legacy per-payment path — under a regime that has since changed. Once a
  // charge is recognized one way, this invoice stays on that path for its whole lifetime.
  const hasAccrualCharge = !existing.immobilisation && !!existing.expense

  let createdPaymentId = ""

  try {
    // amountPaid is updated via an atomic `increment` inside the transaction, same reasoning
    // as facture/[id]/paiements/route.ts — two payments recorded close together can't lose
    // one via a stale read, and the overpayment check runs against the increment's own result.
    const factureRecue = await prisma.$transaction(async (tx) => {
      const payment = await tx.factureRecuePayment.create({
        data: { factureRecueId: id, amount, method, paidAt: paymentDate, note: note || null },
      })
      createdPaymentId = payment.id

      const updated = await tx.factureRecue.update({
        where: { id },
        data:  { amountPaid: { increment: amount } },
      })

      const amountPaid = Number(updated.amountPaid)
      const total       = Number(updated.amount)
      if (amountPaid > total + EPSILON) {
        throw new OverpaymentError(Math.max(0, total - (amountPaid - amount)))
      }
      const newStatus = resolveManualFactureRecueStatus(
        amountPaid >= total - EPSILON ? "PAYEE" : "PARTIELLEMENT_PAYEE",
        amountPaid, total,
      )

      // Immobilisation-linked, or a plain invoice whose accrual charge was already posted
      // (FORM-117): no generic Expense — the payment just settles the payable (404000 or
      // 401000) directly (see post-facture-recue-payment.ts, called outside this transaction
      // below), since the charge was already recognized at acquisition/registration. Otherwise,
      // mirrors the old binary-status flow's single Expense, just one per payment now — now
      // carrying the chosen category (if any) so the existing postExpenseToJournal/
      // ensurePostedJournalEntries catch-up can post it (CASH regime, or an ACCRUAL-regime
      // invoice whose charge hasn't posted yet) without any new posting code.
      if (!existing.immobilisation && !hasAccrualCharge) {
        await tx.expense.create({
          data: {
            associationId,
            exerciceId:            exercice?.id ?? null,
            factureRecuePaymentId: payment.id,
            amount,
            categoryId:  existing.categoryId ?? null,
            status:      "VALIDATED",
            date:        paymentDate,
            vendor:      existing.fournisseur?.companyName ?? null,
            description: factureRecueExpenseDescription(existing),
          },
        })
      }

      return tx.factureRecue.update({
        where: { id },
        data:  { status: newStatus },
        include: { fournisseur: { select: { id: true, companyName: true } }, payments: { orderBy: { paidAt: "desc" } } },
      })
    })

    // Outside the transaction, same posture as every other journal posting call site
    // (post-journal-entry.ts's own idempotencyKey guard makes a retry after a partial
    // failure here safe).
    if (existing.immobilisation || hasAccrualCharge) {
      await postFactureRecuePaymentToJournal(createdPaymentId)
    }

    await writeActivityLog({
      associationId, actorId: userId, action: "FACTURE_RECUE_PAYMENT_ADDED", entity: "FactureRecue", entityId: id, label: factureRecue.number ?? factureRecue.type,
      metadata: { amount, method },
    })

    return NextResponse.json(factureRecue, { status: 201 })
  } catch (err) {
    if (err instanceof OverpaymentError) {
      return NextResponse.json({ error: `Le montant dépasse le solde restant (${err.remaining.toFixed(2)} €)` }, { status: 422 })
    }
    throw err
  }
}, { area: "comptabilite", module: "fournisseurs" })

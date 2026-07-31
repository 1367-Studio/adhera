import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"

type TxClient = Prisma.TransactionClient

// A tiny epsilon guards against float/Decimal rounding noise (e.g. 19.99 + 0.01
// landing on 20.000000000000004) without letting a real overpayment through.
// Mirrors src/app/api/factures/[id]/paiements/route.ts.
const EPSILON = 0.01

export class CotisationOverpaymentError extends Error {
  constructor(public remaining: number) { super("overpayment") }
}

const cotisationInclude = {
  membre:   { select: { id: true, firstName: true, lastName: true, email: true } },
  payments: { orderBy: { paidAt: "desc" as const } },
}

// Deletes the Income row(s) linked to the given CotisationPayment ids, first dropping any
// bank reconciliation pointing at them and resetting the matched bank transaction back to
// UNMATCHED (mirrors src/app/api/factures/[id]/paiements/[paymentId]/route.ts) — otherwise a
// reconciled payment leaves a BankTransaction permanently stuck as "matched" against a row
// that no longer exists, with no way to fix it from the UI.
async function releaseLinkedIncomes(tx: TxClient, paymentIds: string[]) {
  if (paymentIds.length === 0) return
  const incomes = await tx.income.findMany({ where: { cotisationPaymentId: { in: paymentIds } }, select: { id: true } })
  if (incomes.length === 0) return

  const incomeIds = incomes.map(i => i.id)
  const reconciliations = await tx.bankReconciliation.findMany({ where: { incomeId: { in: incomeIds } }, select: { bankTransactionId: true } })
  await tx.bankReconciliation.deleteMany({ where: { incomeId: { in: incomeIds } } })
  if (reconciliations.length > 0) {
    await tx.bankTransaction.updateMany({ where: { id: { in: reconciliations.map(r => r.bankTransactionId) } }, data: { status: "UNMATCHED" } })
  }
  await tx.income.deleteMany({ where: { id: { in: incomeIds } } })
}

// Records one payment against a cotisation: creates the CotisationPayment row, atomically
// increments Cotisation.amountPaid (increment, not read-then-write, so two payments recorded
// close together can't lose one via a stale read), creates the linked Income row, and derives
// the new status from the resulting balance. Called from the dedicated payment route, the
// manual "mark as paid" path (POST/PATCH on the cotisation itself), and the Stripe webhook —
// kept in one place so all three stay consistent instead of re-deriving this transaction body.
export async function recordCotisationPayment(tx: TxClient, params: {
  associationId: string
  cotisationId:  string
  amount:        number
  method:        string
  paidAt?:       Date
  note?:         string | null
  // "MANUAL" for admin-recorded payments (the default), "STRIPE" for the webhook-driven
  // portal checkout flow — passed straight through to the linked Income row.
  source?:       "MANUAL" | "STRIPE"
  reference?:    string | null
}) {
  const existing = await tx.cotisation.findUniqueOrThrow({
    where:  { id: params.cotisationId },
    select: { year: true, membreId: true, membre: { select: { firstName: true, lastName: true } } },
  })

  const paymentDate = params.paidAt ?? new Date()

  const payment = await tx.cotisationPayment.create({
    data: {
      cotisationId: params.cotisationId,
      amount:       params.amount,
      method:       params.method,
      paidAt:       paymentDate,
      note:         params.note || null,
    },
  })

  const updated = await tx.cotisation.update({
    where: { id: params.cotisationId },
    data:  { amountPaid: { increment: params.amount } },
  })

  const amountPaid = Number(updated.amountPaid)
  const amount     = Number(updated.amount)
  if (amountPaid > amount + EPSILON) {
    throw new CotisationOverpaymentError(Math.max(0, amount - (amountPaid - params.amount)))
  }
  const newStatus = amountPaid >= amount - EPSILON ? "PAYE" : "PARTIELLEMENT_PAYEE"

  await tx.income.create({
    data: {
      associationId:       params.associationId,
      memberId:            existing.membreId,
      cotisationPaymentId: payment.id,
      amount:              params.amount,
      paymentMethod:       params.method,
      date:                paymentDate,
      description:         `Cotisation ${existing.year} — ${existing.membre.firstName} ${existing.membre.lastName}`,
      source:              params.source ?? "MANUAL",
      reference:           params.reference ?? null,
      status:              "PAID",
    },
  })

  return tx.cotisation.update({
    where:   { id: params.cotisationId },
    data:    { status: newStatus, ...(newStatus === "PAYE" ? { paidAt: paymentDate } : {}) },
    include: cotisationInclude,
  })
}

// Sends the "payment received" email once a cotisation is fully settled — call after every
// recordCotisationPayment transaction commits (never from inside it: an email a transaction
// later rolls back on would be a lie, and holding a DB transaction open across an outbound
// HTTP call is its own problem). Reports the amount actually charged in *this* transaction,
// not the cotisation's full amount — those differ once partial payments exist (e.g. a second
// payment completing an already partly-paid balance).
export async function sendCotisationPaymentConfirmation(
  cotisation: {
    id:            string
    associationId: string
    year:          number
    status:        string
    paidAt:        Date | null
    membre:        { id: string; firstName: string; email: string | null }
  },
  paymentAmount: number,
) {
  if (cotisation.status !== "PAYE" || !cotisation.membre.email) return

  const association = await prisma.association.findUnique({
    where:  { id: cotisation.associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return

  sendEmail(paymentConfirmationEmail({
    firstName:       cotisation.membre.firstName,
    email:           cotisation.membre.email,
    associationName: association.name,
    amount:          paymentAmount,
    period:          String(cotisation.year),
    paidAt:          cotisation.paidAt ?? new Date(),
    branding:        resolveDocumentBranding(association),
  }), { associationId: cotisation.associationId, membreId: cotisation.membre.id, source: "TRANSACTION", sourceId: cotisation.id }).catch(() => {})
}

// Deletes a single payment and its linked Income (see releaseLinkedIncomes), then recomputes
// amountPaid/status.
export async function removeCotisationPayment(tx: TxClient, cotisationId: string, paymentId: string) {
  const payment = await tx.cotisationPayment.findFirstOrThrow({ where: { id: paymentId, cotisationId } })

  await releaseLinkedIncomes(tx, [paymentId])
  await tx.cotisationPayment.delete({ where: { id: paymentId } })

  const updated = await tx.cotisation.update({
    where: { id: cotisationId },
    data:  { amountPaid: { decrement: payment.amount } },
  })

  const amountPaid = Number(updated.amountPaid)
  const amount     = Number(updated.amount)
  const newStatus =
    updated.status === "PAYE" || updated.status === "PARTIELLEMENT_PAYEE"
      ? (amountPaid <= EPSILON ? "EN_ATTENTE" : amountPaid >= amount - EPSILON ? "PAYE" : "PARTIELLEMENT_PAYEE")
      : updated.status

  return tx.cotisation.update({
    where:   { id: cotisationId },
    data:    { status: newStatus, ...(newStatus !== "PAYE" ? { paidAt: null } : {}) },
    include: cotisationInclude,
  })
}

// Wipes every payment on a cotisation (and their linked Income rows) — used when an admin
// manually flips status back down from PAYE/PARTIELLEMENT_PAYEE to EN_ATTENTE/EXONERE via the
// edit form, since that no longer matches "amount actually collected via recorded payments".
export async function reverseCotisationPayments(tx: TxClient, cotisationId: string) {
  const payments = await tx.cotisationPayment.findMany({ where: { cotisationId }, select: { id: true } })
  if (payments.length === 0) return

  const paymentIds = payments.map(p => p.id)
  await releaseLinkedIncomes(tx, paymentIds)
  await tx.cotisationPayment.deleteMany({ where: { cotisationId } })
  await tx.cotisation.update({ where: { id: cotisationId }, data: { amountPaid: 0 } })
}

// Deletes a cotisation along with its payment history — CotisationPayment rows cascade-delete
// with the Cotisation at the DB level, but their linked Income rows only SetNull on that FK,
// so they're released explicitly first (see releaseLinkedIncomes).
export async function deleteCotisationWithPayments(tx: TxClient, cotisationId: string) {
  const payments = await tx.cotisationPayment.findMany({ where: { cotisationId }, select: { id: true } })
  await releaseLinkedIncomes(tx, payments.map(p => p.id))
  await tx.cotisation.delete({ where: { id: cotisationId } })
}

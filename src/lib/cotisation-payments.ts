import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { deriveCotisationStatus } from "@/lib/cotisation-status"
import { isMemberCardAvailable } from "@/lib/member-card/availability"
import { APP_URL } from "@/lib/env"

type TxClient = Prisma.TransactionClient

// A tiny epsilon guards against float/Decimal rounding noise (e.g. 19.99 + 0.01
// landing on 20.000000000000004) without letting a real overpayment through.
// Mirrors src/app/api/factures/[id]/paiements/route.ts. Exported so cotisation-status.ts
// shares the exact same tolerance instead of redeclaring its own copy.
export const EPSILON = 0.01

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
  // Resolved by the caller (resolveExerciceForDate, guarded with closedExerciceGuard for
  // admin-initiated payments, best-effort/OUVERT-only for the Stripe webhook — see callers)
  // before the transaction opens, same as every other Income-creating write path.
  exerciceId?:   string | null
}) {
  const existing = await tx.cotisation.findUniqueOrThrow({
    where:  { id: params.cotisationId },
    select: {
      year: true, membreId: true, membre: { select: { firstName: true, lastName: true } },
      status: true, amount: true, dueDate: true,
      installments: { select: { amount: true, dueDate: true, order: true } },
    },
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
  // Defensive: recording a payment against an EXONERE/ANNULEE cotisation is already blocked
  // upstream by the route guards, but deriveCotisationStatus's own manual-status guard keeps
  // this the single choke point that can never silently promote one of those to PAYE.
  const newStatus = deriveCotisationStatus({
    currentStatus: existing.status,
    amount,
    amountPaid,
    dueDate:       existing.dueDate,
    installments:  existing.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  })

  await tx.income.create({
    data: {
      associationId:       params.associationId,
      exerciceId:          params.exerciceId ?? null,
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
    select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!association) return

  // Ce paiement vient peut-être de débloquer la carte de membre — mais "cotisation payée"
  // n'est pas la règle (carte désactivée par l'association, membre suspendu, cotisation
  // réglée d'avance pour une période future), donc on interroge la source unique de vérité
  // plutôt que de la redériver ici. Le lien pointe vers l'espace membre, pas vers la page
  // publique scannée : pas de token à générer.
  const memberCardAvailable = await isMemberCardAvailable(cotisation.associationId, cotisation.membre.id)

  sendEmail(paymentConfirmationEmail({
    firstName:       cotisation.membre.firstName,
    email:           cotisation.membre.email,
    associationName: association.name,
    amount:          paymentAmount,
    period:          String(cotisation.year),
    paidAt:          cotisation.paidAt ?? new Date(),
    branding:        resolveDocumentBranding(association),
    memberCardUrl:   memberCardAvailable ? `${APP_URL}/portal/${association.slug}/carte` : undefined,
  }), { associationId: cotisation.associationId, membreId: cotisation.membre.id, source: "TRANSACTION", sourceId: cotisation.id }).catch(() => {})
}

// Deletes a single payment and its linked Income (see releaseLinkedIncomes), then recomputes
// amountPaid/status.
export async function removeCotisationPayment(tx: TxClient, cotisationId: string, paymentId: string) {
  const payment = await tx.cotisationPayment.findFirstOrThrow({ where: { id: paymentId, cotisationId } })

  await releaseLinkedIncomes(tx, [paymentId])
  await tx.cotisationPayment.delete({ where: { id: paymentId } })

  return rederiveAfterPaymentRemoval(tx, cotisationId, payment.amount)
}

// The full-refund counterpart of removeCotisationPayment, for the Stripe webhook's
// charge.refunded safety net. Same amountPaid/status outcome (same shared tail below), but the
// linked Income is soft-cancelled (status CANCELLED, row kept) instead of deleted — the
// treatment that webhook already gives every other refunded Income, so the ledger keeps a trace
// of money that came in and went back out. Deleting the CotisationPayment then detaches that
// row on its own (Income.cotisationPaymentId is onDelete: SetNull), which is also what makes a
// redelivered refund event find nothing left to reverse.
// Returns null when there's nothing to remove — a redelivered event, or a concurrent delivery
// of the same one that got there first. deleteMany's count decides, not the read above it: two
// deliveries racing on the same payment both see it, but only one delete can match the row, so
// its amount can never be given back twice.
export async function removeRefundedCotisationPayment(tx: TxClient, paymentId: string) {
  const payment = await tx.cotisationPayment.findUnique({ where: { id: paymentId }, select: { cotisationId: true, amount: true } })
  if (!payment) return null

  await tx.income.updateMany({ where: { cotisationPaymentId: paymentId, status: "PAID" }, data: { status: "CANCELLED" } })
  const { count: deletedCount } = await tx.cotisationPayment.deleteMany({ where: { id: paymentId } })
  if (deletedCount === 0) return null

  return rederiveAfterPaymentRemoval(tx, payment.cotisationId, payment.amount)
}

// Reverses every cotisation payment a fully-refunded Stripe charge had paid for, found through
// the Income each one posted with that charge's reference (a PaymentIntent id for a checkout, an
// invoice id for a subscription/installment charge — see the recordCotisationPayment callers)
// rather than through Stripe metadata: a group checkout pays N cotisations with no id of theirs
// in metadata at all, and a public one-off adhésion only gets its cotisationId backfilled onto
// the PaymentIntent best-effort (see membership-forms.ts). One transaction for the whole charge
// — a group refund reverses every registrant's cotisation or none. Returns the cotisations
// actually reversed (empty on a redelivery, see removeRefundedCotisationPayment).
// `auditMetadata` is stored on each COTISATION_REFUNDED activity log written below — the caller
// passes whatever identifies the charge on Stripe's side (PaymentIntent id, invoice id, event id).
// `associationId` only narrows the lookup onto the (associationId, reference) index — a Stripe
// reference is unique platform-wide, so it changes no result. It is optional because the webhook
// reads it from PaymentIntent metadata, which a PaymentIntent created before that metadata
// existed simply doesn't carry; undefined is ignored by Prisma and the query stays as it was.
export async function removeRefundedCotisationPaymentsByReference(
  reference: string,
  auditMetadata: Prisma.InputJsonObject,
  associationId?: string,
) {
  const linkedIncomes = await prisma.income.findMany({
    where:   { associationId, reference, cotisationPaymentId: { not: null } },
    select:  { cotisationPaymentId: true },
    // Deterministic lock order, so two concurrent deliveries of the same group refund can't
    // deadlock on each other's rows.
    orderBy: { cotisationPaymentId: "asc" },
  })
  const paymentIds = linkedIncomes.map(income => income.cotisationPaymentId).filter((paymentId): paymentId is string => paymentId !== null)
  if (paymentIds.length === 0) return []

  return prisma.$transaction(async (tx) => {
    const reversedCotisations = []
    for (const paymentId of paymentIds) {
      const reversedCotisation = await removeRefundedCotisationPayment(tx, paymentId)
      if (reversedCotisation) reversedCotisations.push(reversedCotisation)
    }

    // The audit trail is written here, inside the reversal's own transaction, rather than by
    // the caller once this returns. The reversal is idempotent by design — a retry finds the
    // payments already gone and reverses nothing — so a crash between the commit and a
    // caller-side log would leave a reversal with no trace at all, and no Stripe redelivery
    // could ever put it back. Written straight on `tx` instead of through writeActivityLog:
    // that helper runs on the global client (its own connection, hence its own transaction)
    // and swallows its errors, neither of which gives the atomicity wanted here. If this
    // insert fails, nothing commits and Stripe's retry runs the whole reversal again — the
    // refund reversal is delayed, never silently left untraced.
    if (reversedCotisations.length > 0) {
      await tx.activityLog.createMany({
        data: reversedCotisations.map(reversedCotisation => ({
          associationId: reversedCotisation.associationId,
          action:        "COTISATION_REFUNDED",
          entity:        "Cotisation",
          entityId:      reversedCotisation.id,
          label:         `${reversedCotisation.membre.firstName} ${reversedCotisation.membre.lastName} — ${reversedCotisation.year}`,
          metadata:      auditMetadata,
        })),
      })
    }

    return reversedCotisations
  }, {
    // A group checkout reverses every registrant in this one interactive transaction, at
    // roughly eight queries each (payment lookup, income soft-cancel, payment delete, the two
    // cotisation updates in rederiveAfterPaymentRemoval and their includes) — a dozen
    // registrants is already well past Prisma's 5 s default, and a timeout would abort the
    // exact same way on every Stripe redelivery instead of eventually going through. Still
    // bounded, so a genuinely stuck transaction doesn't hold its rows indefinitely.
    timeout: 60_000,
  })
}

// Idempotency guard for a payment keyed on a Stripe object (an invoice id — see the invoice.paid
// handlers in src/lib/webhook/). Stripe delivers at least once, and the webhook deliberately
// answers non-2xx to an invoice.paid that beats its own checkout (see
// shouldRetryUntilCheckoutProcessed), so a retry of an already-recorded invoice is routine, not
// exotic. The Income that recordCotisationPayment posts with that reference is the durable proof
// — kept even after a refund, only soft-cancelled (see removeRefundedCotisationPayment), so a
// refunded invoice can't be re-recorded either. Must run inside the transaction that records the
// payment: it first takes a row lock on the cotisation (same FOR UPDATE pattern as the event
// capacity checks), so a concurrent delivery of the same event waits here until this one
// commits and then sees its Income, instead of both finding nothing and both recording. There's
// no unique constraint on Income.reference to lean on instead — one PaymentIntent legitimately
// backs several Income rows (boutique categories, group checkouts).
export async function isReferenceAlreadyRecorded(tx: TxClient, params: {
  associationId: string
  cotisationId:  string
  reference:     string
}): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "Cotisation" WHERE id = ${params.cotisationId} FOR UPDATE`
  const existingIncome = await tx.income.findFirst({
    where:  { associationId: params.associationId, reference: params.reference },
    select: { id: true },
  })
  return existingIncome !== null
}

// Shared tail of removeCotisationPayment/removeRefundedCotisationPayment: gives the removed
// amount back and re-derives the status from the resulting balance, so both removal paths land
// on exactly the same amountPaid/status for the same payment.
async function rederiveAfterPaymentRemoval(tx: TxClient, cotisationId: string, removedAmount: Prisma.Decimal) {
  const updated = await tx.cotisation.update({
    where:  { id: cotisationId },
    data:   { amountPaid: { decrement: removedAmount } },
    include: { installments: { select: { amount: true, dueDate: true, order: true } } },
  })

  const amountPaid = Number(updated.amountPaid)
  const amount     = Number(updated.amount)
  // Unconditional (not gated to PAYE/PARTIELLEMENT_PAYEE like before EN_RETARD existed) —
  // removing a payment from a late cotisation must also reconsider whether it's still late,
  // not just whether it's still fully/partially paid. deriveCotisationStatus's own guard
  // still leaves EXONERE/ANNULEE untouched.
  const newStatus = deriveCotisationStatus({
    currentStatus: updated.status,
    amount,
    amountPaid,
    dueDate:       updated.dueDate,
    installments:  updated.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
  })

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

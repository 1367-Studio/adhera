import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { cotisationUpdateSchema, installmentsSumMismatch } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { closedExerciceGuard } from "@/lib/finance/exercice"
import { reverseCotisationPayments, deleteCotisationWithPayments } from "@/lib/cotisation-payments"
import { deriveCotisationStatus, type CotisationStatus } from "@/lib/cotisation-status"

const EPSILON = 0.01

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const cotisationInclude = {
  membre:       { select: { id: true, firstName: true, lastName: true, email: true } },
  payments:     { orderBy: { paidAt: "desc" as const } },
  installments: { orderBy: { order: "asc" as const } },
}

// Same shape as sums, compared index-by-index — the client always resends the full array in
// its intended order (no drag-to-reorder UI), so index position doubles as `order`. Mirrors
// itemsUnchanged in src/lib/devis-calc.ts for the equivalent Facture/items case.
function installmentsUnchanged(
  existing: { amount: unknown; dueDate: Date }[],
  next: { amount: number; dueDate: string }[],
): boolean {
  if (existing.length !== next.length) return false
  return existing.every((inst, i) => {
    const n = next[i]
    return Math.abs(Number(inst.amount) - n.amount) < EPSILON
      && inst.dueDate.toISOString().slice(0, 10) === n.dueDate
  })
}

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({
    where:   { id, associationId, membre: { deletedAt: null } },
    include: { installments: { orderBy: { order: "asc" }, select: { amount: true, dueDate: true, order: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = cotisationUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const settingExonere = parsed.data.status === "EXONERE"
  const settingAnnulee = parsed.data.status === "ANNULEE"

  const { dueDate, note, amount, installments, status: rawStatus } = parsed.data

  // Only checked when payments aren't about to be wiped wholesale by settingExonere below —
  // in that case amountPaid is going back to 0 anyway, so the comparison would be moot.
  if (!settingExonere && amount !== undefined && amount < Number(existing.amountPaid) - EPSILON) {
    return NextResponse.json(
      { error: `Le nouveau montant (${amount.toFixed(2)} €) est inférieur à ce qui a déjà été payé (${Number(existing.amountPaid).toFixed(2)} €) — ajustez ou supprimez des paiements d'abord.` },
      { status: 409 },
    )
  }

  const resolvedAmount  = amount ?? Number(existing.amount)
  const resolvedDueDate = dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : existing.dueDate

  // The Zod schema can't validate this cross-field invariant on its own (an update may send
  // `installments` without `amount`, and the schema has no way to know the existing amount to
  // check against) — done here instead, against the resolved (possibly-existing) amount.
  if (installments !== undefined && installmentsSumMismatch({ amount: resolvedAmount, installments })) {
    return NextResponse.json(
      { error: "Le total des échéances ne correspond pas au montant de la cotisation.", path: ["installments"] },
      { status: 422 },
    )
  }

  const installmentsChanged = installments !== undefined && !installmentsUnchanged(existing.installments, installments)

  // Editing the schedule after money has already moved against it would silently change what
  // "covered" means for the waterfall (src/lib/cotisation-status.ts) in ways the admin didn't
  // necessarily intend — e.g. removing an already-paid-for installment could make a later,
  // still-due one look "first uncovered" at a different date. Exempted when settingExonere:
  // payments are being wiped in this same request anyway, so there's nothing left to protect.
  if (installmentsChanged && !settingExonere && Number(existing.amountPaid) > EPSILON) {
    return NextResponse.json(
      { error: "Cette cotisation a des paiements enregistrés — supprimez-les d'abord pour modifier les échéances." },
      { status: 409 },
    )
  }

  const resolvedInstallments = installments !== undefined
    ? installments.map((i, order) => ({ amount: i.amount, dueDate: new Date(i.dueDate), order }))
    : existing.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order }))

  // `status` key absent (undefined) → no explicit intent, keep whatever manual override the
  // row already carries (deriveCotisationStatus passes EXONERE/ANNULEE through unchanged).
  // `status: null` → the form's "Automatique" option: force a full recompute even off an
  // existing manual override, by seeding with a non-manual status.
  //
  // This preview (using the pre-transaction `existing` snapshot) only drives the Stripe guard
  // just below — it's a best-effort early rejection, not the value actually persisted. The
  // real write re-derives status from a fresh read taken inside the transaction (see below),
  // so a payment landing concurrently (e.g. a Stripe webhook) between this read and the write
  // can't leave a stale status on the row.
  const previewStatus: CotisationStatus = settingExonere ? "EXONERE" : settingAnnulee ? "ANNULEE" : deriveCotisationStatus({
    currentStatus: rawStatus === null ? "EN_ATTENTE" : (existing.status as CotisationStatus),
    amount:        resolvedAmount,
    amountPaid:    settingExonere ? 0 : Number(existing.amountPaid),
    dueDate:       resolvedDueDate,
    installments:  resolvedInstallments,
  })

  // Gate on the actual outcome, not just on the client having sent a `status` key — resending
  // the "Automatique" sentinel (status: null) on an already-PAYE cotisation resolves right
  // back to PAYE via deriveCotisationStatus above and must not be treated as a reversion.
  // ANNULEE is exempt: cancelling a Stripe-paid cotisation is fine, since payments/Income
  // stay untouched (see settingAnnulee branch below) — nothing is misrepresented.
  const revertingStripePayment =
    existing.status === "PAYE" && previewStatus !== "PAYE" && previewStatus !== "ANNULEE" && !!existing.stripeSessionId

  if (revertingStripePayment) {
    return NextResponse.json(
      { error: "Cette cotisation a été payée par carte — remboursez le paiement depuis Stripe avant de modifier son statut." },
      { status: 422 },
    )
  }

  if (settingExonere) {
    const closedLinkedIncome = await prisma.income.findFirst({
      where:  { cotisationPayment: { cotisationId: id }, exercice: { status: "CLOTURE" } },
      select: { id: true },
    })
    const guard = closedExerciceGuard(closedLinkedIncome ? "CLOTURE" : null)
    if (guard) return guard
  }

  const cotisation = await prisma.$transaction(async (tx) => {
    if (installments !== undefined) {
      await tx.cotisationInstallment.deleteMany({ where: { cotisationId: id } })
    }

    // Fresh read, taken just before the write that will persist `status` — narrows the race
    // window against a concurrent payment (see comment on `previewStatus` above) down to the
    // transaction's own duration instead of this whole request's.
    const fresh = await tx.cotisation.findUniqueOrThrow({
      where:  { id },
      select: { status: true, amountPaid: true },
    })
    const finalStatus: CotisationStatus = settingExonere ? "EXONERE" : settingAnnulee ? "ANNULEE" : deriveCotisationStatus({
      currentStatus: rawStatus === null ? "EN_ATTENTE" : (fresh.status as CotisationStatus),
      amount:        resolvedAmount,
      amountPaid:    settingExonere ? 0 : Number(fresh.amountPaid),
      dueDate:       resolvedDueDate,
      installments:  resolvedInstallments,
    })

    const updated = await tx.cotisation.update({
      where: { id },
      data: {
        status:  finalStatus,
        ...(amount  !== undefined ? { amount }                                : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(note    !== undefined ? { note: note || null }                    : {}),
        ...(installments !== undefined && installments.length > 0 ? {
          installments: { create: installments.map((i, order) => ({ amount: i.amount, dueDate: new Date(i.dueDate), order })) },
        } : {}),
      },
      include: cotisationInclude,
    })

    if (settingExonere) {
      await reverseCotisationPayments(tx, id)
      return tx.cotisation.findUniqueOrThrow({ where: { id }, include: cotisationInclude })
    }

    return updated
  })

  const changes = computeDiff(
    existing   as unknown as Record<string, unknown>,
    cotisation as unknown as Record<string, unknown>,
    ["status", "amount", "dueDate", "note"],
  )
  await writeActivityLog({ associationId, actorId: userId, action: "COTISATION_UPDATED", entity: "Cotisation", entityId: id, label: `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}`, metadata: Object.keys(changes).length > 0 ? { changes } : undefined })
  return NextResponse.json(cotisation)
}, { roles: MANAGERS, module: "cotisations" })

export const DELETE = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({
    where:   { id, associationId, membre: { deletedAt: null } },
    include: { membre: { select: { firstName: true, lastName: true } }, payments: { select: { id: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  if (existing.status === "PAYE" && existing.stripeSessionId) {
    return NextResponse.json(
      { error: "Cette cotisation a été payée par carte — remboursez le paiement depuis Stripe avant de la supprimer." },
      { status: 422 },
    )
  }

  if (existing.payments.length > 0) {
    const closedLinkedIncome = await prisma.income.findFirst({
      where:  { cotisationPayment: { cotisationId: id }, exercice: { status: "CLOTURE" } },
      select: { id: true },
    })
    const guard = closedExerciceGuard(closedLinkedIncome ? "CLOTURE" : null)
    if (guard) return guard
  }

  let force = false
  try {
    const parsedBody = await req.json()
    force = parsedBody?.force === true
  } catch {
    // No body sent — force stays false
  }

  if (existing.payments.length > 0 && !force) {
    return NextResponse.json(
      { error: "Cette cotisation a des paiements enregistrés — les supprimer aussi ? Confirmez la suppression.", code: "REQUIRES_CONFIRMATION" },
      { status: 409 },
    )
  }

  await prisma.$transaction((tx) => deleteCotisationWithPayments(tx, id))
  await writeActivityLog({ associationId, actorId: userId, action: "COTISATION_DELETED", entity: "Cotisation", entityId: id, label: `${existing.membre.firstName} ${existing.membre.lastName} — ${existing.year}` })
  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "cotisations" })

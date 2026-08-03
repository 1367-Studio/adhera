import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { cotisationUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import type { ExerciceStatus } from "@prisma/client"
import { recordCotisationPayment, reverseCotisationPayments, sendCotisationPaymentConfirmation, deleteCotisationWithPayments } from "@/lib/cotisation-payments"

const EPSILON = 0.01

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({ where: { id, associationId, membre: { deletedAt: null } } })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = cotisationUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const revertingStripePayment =
    existing.status === "PAYE" &&
    parsed.data.status !== undefined &&
    parsed.data.status !== "PAYE" &&
    !!existing.stripeSessionId

  if (revertingStripePayment) {
    return NextResponse.json(
      { error: "Cette cotisation a été payée par carte — remboursez le paiement depuis Stripe avant de modifier son statut." },
      { status: 422 },
    )
  }

  // PARTIELLEMENT_PAYEE is never a value a client should be able to assert out of thin air —
  // it's only ever reached through an actual recorded payment (see recordCotisationPayment).
  // Resubmitting the record's own current value (e.g. editing the note on an already
  // partially-paid cotisation) is fine; asserting it as a *new* value is not.
  if (parsed.data.status === "PARTIELLEMENT_PAYEE" && existing.status !== "PARTIELLEMENT_PAYEE") {
    return NextResponse.json({ error: "Ce statut ne peut pas être défini manuellement." }, { status: 422 })
  }

  const becomingPaid   = parsed.data.status === "PAYE" && existing.status !== "PAYE"
  const unbecomingPaid = (existing.status === "PAYE" || existing.status === "PARTIELLEMENT_PAYEE")
    && parsed.data.status !== undefined && parsed.data.status !== "PAYE" && parsed.data.status !== "PARTIELLEMENT_PAYEE"

  // Resolve/guard before touching anything: becomingPaid needs the target period for the new
  // payment's Income row, unbecomingPaid needs the period every already-linked payment sits in.
  let newExercice: { id: string; status: ExerciceStatus } | null = null
  if (becomingPaid) {
    newExercice = await resolveExerciceForDate(associationId, new Date(parsed.data.paidAt as string))
    const guard = closedExerciceGuard(newExercice?.status)
    if (guard) return guard
  }
  if (unbecomingPaid) {
    const closedLinkedIncome = await prisma.income.findFirst({
      where:  { cotisationPayment: { cotisationId: id }, exercice: { status: "CLOTURE" } },
      select: { id: true },
    })
    const guard = closedExerciceGuard(closedLinkedIncome ? "CLOTURE" : null)
    if (guard) return guard
  }

  const { paidAt, dueDate, paymentMethod, note, amount, ...rest } = parsed.data

  // Only checked when payments aren't about to be wiped wholesale by unbecomingPaid below —
  // in that case amountPaid is going back to 0 anyway, so the comparison would be moot.
  if (!unbecomingPaid && amount !== undefined && amount < Number(existing.amountPaid) - EPSILON) {
    return NextResponse.json(
      { error: `Le nouveau montant (${amount.toFixed(2)} €) est inférieur à ce qui a déjà été payé (${Number(existing.amountPaid).toFixed(2)} €) — ajustez ou supprimez des paiements d'abord.` },
      { status: 409 },
    )
  }

  // Quick "mark as paid" from the form only makes sense with both of these — required here
  // rather than in the zod schema, since the schema can't tell a genuine EN_ATTENTE/
  // PARTIELLEMENT_PAYEE → PAYE transition from a client just resubmitting an already-PAYE
  // record's unrelated fields (where re-picking a payment method makes no sense).
  if (becomingPaid) {
    if (!paidAt) return NextResponse.json({ error: "Date de paiement requise quand le statut est Payée" }, { status: 422 })
    if (!paymentMethod) return NextResponse.json({ error: "Moyen de paiement requis quand le statut est Payée" }, { status: 422 })
  }

  let cotisation = await prisma.cotisation.update({
    where: { id },
    data: {
      ...rest,
      ...(amount    !== undefined ? { amount: amount }                                : {}),
      ...(paidAt    !== undefined ? { paidAt: paidAt ? new Date(paidAt) : null }      : {}),
      ...(dueDate   !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null }   : {}),
      ...(note      !== undefined ? { note:   note   || null }                        : {}),
    },
    include: { membre: { select: { id: true, firstName: true, lastName: true, email: true } }, payments: { orderBy: { paidAt: "desc" } } },
  })

  let paidJustNow = 0
  if (becomingPaid && cotisation.amount != null) {
    const remaining = Number(cotisation.amount) - Number(existing.amountPaid)
    if (remaining > EPSILON) {
      cotisation = await prisma.$transaction((tx) => recordCotisationPayment(tx, {
        associationId,
        cotisationId: id,
        amount:       remaining,
        method:       paymentMethod!,
        paidAt:       paidAt ? new Date(paidAt) : undefined,
        exerciceId:   newExercice?.id ?? null,
      }))
      paidJustNow = remaining
    }
  }

  if (unbecomingPaid) {
    await prisma.$transaction((tx) => reverseCotisationPayments(tx, id))
    cotisation = await prisma.cotisation.findUniqueOrThrow({
      where:   { id },
      include: { membre: { select: { id: true, firstName: true, lastName: true, email: true } }, payments: { orderBy: { paidAt: "desc" } } },
    })
  }

  if (paidJustNow > 0) {
    await sendCotisationPaymentConfirmation(cotisation, paidJustNow)
  }

  const changes = computeDiff(
    existing   as Record<string, unknown>,
    cotisation as Record<string, unknown>,
    ["status", "amount", "dueDate", "paidAt", "note"],
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

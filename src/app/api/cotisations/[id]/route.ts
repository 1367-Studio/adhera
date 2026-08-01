import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { cotisationUpdateSchema } from "@/lib/schemas"
import { sendEmail } from "@/lib/mail"
import { paymentConfirmationEmail } from "@/lib/email"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import type { ExerciceStatus } from "@prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({
    where:   { id, associationId, membre: { deletedAt: null } },
    include: { membre: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })
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

  const becomingPaid = parsed.data.status === "PAYE" && existing.status !== "PAYE"
  // Must require an explicit status change — omitting `status` in a partial PATCH must never
  // be read as "leaving PAYE", or any unrelated edit (e.g. a note) would delete the Income.
  const unbecomingPaid = existing.status === "PAYE" && parsed.data.status !== undefined && parsed.data.status !== "PAYE"

  // Resolve/guard before touching anything: becomingPaid needs the target period for the new
  // paidAt, unbecomingPaid needs the period the existing linked Income already sits in.
  let newExercice: { id: string; status: ExerciceStatus } | null = null
  if (becomingPaid) {
    newExercice = await resolveExerciceForDate(associationId, new Date(parsed.data.paidAt as string))
    const guard = closedExerciceGuard(newExercice?.status)
    if (guard) return guard
  }

  // membreId/year are immutable via this endpoint (omitted from cotisationUpdateSchema), so
  // the description used to look up the linked Income is stable before and after the update.
  const incomeDesc = `Cotisation ${existing.year} — ${existing.membre.firstName} ${existing.membre.lastName}`

  if (unbecomingPaid) {
    const linkedIncome = await prisma.income.findFirst({
      where:  { associationId, memberId: existing.membreId, description: incomeDesc },
      select: { exercice: { select: { status: true } } },
    })
    const guard = closedExerciceGuard(linkedIncome?.exercice?.status)
    if (guard) return guard
  }

  const { paidAt, note, amount, ...rest } = parsed.data
  const cotisation = await prisma.cotisation.update({
    where: { id },
    data: {
      ...rest,
      ...(amount !== undefined ? { amount: amount }                           : {}),
      ...(paidAt !== undefined ? { paidAt: paidAt ? new Date(paidAt) : null } : {}),
      ...(note   !== undefined ? { note:   note   || null }                   : {}),
    },
    include: { membre: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })

  if (becomingPaid && cotisation.amount != null) {
    await prisma.income.deleteMany({ where: { associationId, memberId: existing.membreId, description: incomeDesc } })
    await prisma.income.create({
      data: {
        associationId,
        exerciceId:  newExercice?.id ?? null,
        memberId:    existing.membreId,
        amount:      cotisation.amount,
        description: incomeDesc,
        source:      "MANUAL",
        status:      "PAID",
        date:        cotisation.paidAt ?? new Date(),
      },
    })
  }

  if (unbecomingPaid) {
    await prisma.income.deleteMany({ where: { associationId, memberId: existing.membreId, description: incomeDesc } })
  }

  if (becomingPaid && cotisation.membre.email) {
    const assoc = await prisma.association.findUnique({
      where:  { id: associationId },
      select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
    })
    if (assoc) {
      sendEmail(paymentConfirmationEmail({
        firstName:       cotisation.membre.firstName,
        email:           cotisation.membre.email,
        associationName: assoc.name,
        amount:          cotisation.amount ? Number(cotisation.amount) : null,
        period:          String(cotisation.year),
        paidAt:          cotisation.paidAt ?? new Date(),
        branding:        resolveDocumentBranding(assoc),
      })).catch(() => {})
    }
  }

  const changes = computeDiff(
    existing   as Record<string, unknown>,
    cotisation as Record<string, unknown>,
    ["status", "amount", "paidAt", "note"],
  )
  await writeActivityLog({ associationId, actorId: userId, action: "COTISATION_UPDATED", entity: "Cotisation", entityId: id, label: `${cotisation.membre.firstName} ${cotisation.membre.lastName} — ${cotisation.year}`, metadata: Object.keys(changes).length > 0 ? { changes } : undefined })
  return NextResponse.json(cotisation)
}, { roles: MANAGERS, module: "cotisations" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.cotisation.findFirst({
    where:   { id, associationId, membre: { deletedAt: null } },
    include: { membre: { select: { firstName: true, lastName: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 })

  if (existing.status === "PAYE" && existing.stripeSessionId) {
    return NextResponse.json(
      { error: "Cette cotisation a été payée par carte — remboursez le paiement depuis Stripe avant de la supprimer." },
      { status: 422 },
    )
  }

  const incomeDesc = `Cotisation ${existing.year} — ${existing.membre.firstName} ${existing.membre.lastName}`

  if (existing.status === "PAYE") {
    const linkedIncome = await prisma.income.findFirst({
      where:  { associationId, memberId: existing.membreId, description: incomeDesc },
      select: { exercice: { select: { status: true } } },
    })
    const guard = closedExerciceGuard(linkedIncome?.exercice?.status)
    if (guard) return guard
  }

  await prisma.$transaction([
    prisma.income.deleteMany({ where: { associationId, memberId: existing.membreId, description: incomeDesc } }),
    prisma.cotisation.delete({ where: { id } }),
  ])
  await writeActivityLog({ associationId, actorId: userId, action: "COTISATION_DELETED", entity: "Cotisation", entityId: id, label: `${existing.membre.firstName} ${existing.membre.lastName} — ${existing.year}` })
  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "cotisations" })

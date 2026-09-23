import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { isEvenementOver } from "@/lib/evenement-timing"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import {
  TicketPaymentError, applyDoorPayment, assertSeatAvailable, doorPaymentSchema, evenementHasFee,
  evenementTicketPaymentSelect,
} from "@/lib/evenement-ticket-payment"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const bodySchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional(),
  // Paid event only — "now" records the payment in the same transaction, "later" reserves
  // the seat (rsvp CONFIRME) until "Marquer payé". Absent = previous behaviour.
  payment:   doorPaymentSchema.optional(),
})

// Lets the organizer add someone directly to the door list who never went through
// RSVP/checkout — a walk-in guest with no Membre record at all.
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { ...evenementTicketPaymentSelect, date: true, endDate: true, capacity: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (isEvenementOver(evenement))
    return NextResponse.json({ error: "Impossible de modifier la liste d'un événement déjà passé." }, { status: 422 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { firstName, lastName, email, payment } = parsed.data

  if (payment && !evenementHasFee(evenement))
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })

  const paidAt = new Date()
  let exerciceId: string | null = null
  if (payment?.mode === "now") {
    const exercice = await resolveExerciceForDate(associationId, paidAt)
    const exerciceGuard = closedExerciceGuard(exercice?.status)
    if (exerciceGuard) return exerciceGuard
    exerciceId = exercice?.id ?? null
  }

  // Capacity follows the same occupancy rule as everywhere else (paid OR rsvp CONFIRME) —
  // this used to count present rows only, which let the door list overshoot a capacity already
  // filled by paid/reserved registrations that hadn't been checked in yet.
  // present stays false (schema default) — a walk-in added by the association must wait
  // for an explicit presence validation on the day, not be auto-checked-in here.
  let participation
  try {
    participation = await prisma.$transaction(async transaction => {
      await assertSeatAvailable(transaction, { evenementId, capacity: evenement.capacity })
      const created = await transaction.participation.create({
        data: { associationId, evenementId, firstName, lastName, email: email ?? null },
      })
      if (!payment) return created
      return applyDoorPayment(transaction, { associationId, evenement, participation: created, payment, paidAt, exerciceId })
    })
  } catch (error) {
    if (error instanceof TicketPaymentError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "PARTICIPANT_ADDED",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { memberName: `${firstName} ${lastName}`, guest: true },
  })
  if (payment?.mode === "now") {
    await writeActivityLog({
      associationId,
      actorId:  userId,
      action:   "TICKET_PAID",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { memberName: `${firstName} ${lastName}`, guest: true, paymentMethod: participation.paymentMethod },
    })
  }

  return NextResponse.json(participation, { status: 201 })
})

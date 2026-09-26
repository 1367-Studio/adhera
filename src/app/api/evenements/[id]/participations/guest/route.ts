import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { isEvenementOver } from "@/lib/evenement-timing"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { APP_URL } from "@/lib/env"
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
    select: { ...evenementTicketPaymentSelect, date: true, endDate: true, capacity: true, location: true, slug: true },
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

  // A walk-in guest never went through RSVP/checkout, so without this they'd get no email
  // at all — unlike every other way a Participation can be created. Only when a real seat
  // state exists (paid, or reserved via "later") does it carry an entry QR + cancel link,
  // same eligibility rule as the "Envoyer les QR manquants" backfill (see occupiedSeatWhere) —
  // a free event added with no payment choice has no such state to hand out a token for.
  if (email) {
    const assoc = await prisma.association.findUnique({
      where:  { id: associationId },
      select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    })
    if (assoc) {
      const hasConfirmedSeat = participation.ticketPaidAt != null || participation.rsvp === "CONFIRME"
      let ticketQr:  { imageUrl: string; pageUrl: string } | undefined
      let cancelUrl: string | undefined
      if (hasConfirmedSeat) {
        const ticketToken = randomBytes(20).toString("hex")
        const cancelToken  = randomBytes(20).toString("hex")
        await prisma.participation.update({ where: { id: participation.id }, data: { ticketToken, cancelToken } })
        ticketQr  = { imageUrl: `${APP_URL}/api/public/billet/${ticketToken}/qr`, pageUrl: `${APP_URL}/billet/${ticketToken}` }
        cancelUrl = `${APP_URL}/annulation/${cancelToken}`
      }
      await sendEmail(rsvpConfirmationEmail({
        firstName,
        email,
        associationName: assoc.name,
        eventTitle:      evenement.title,
        eventDate:       evenement.date,
        eventLocation:   evenement.location,
        portalUrl:       `${APP_URL}/${assoc.slug}/evenements/${evenement.slug ?? evenementId}`,
        cancelUrl,
        ticketQr,
        branding: resolveDocumentBranding(assoc),
      }), { associationId, source: "EVENT_GUEST_ADDED", sourceId: participation.id }).catch(() => {})
    }
  }

  return NextResponse.json(participation, { status: 201 })
})

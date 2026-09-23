import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { isEvenementOver } from "@/lib/evenement-timing"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import {
  TicketPaymentError, applyDoorPayment, assertSeatAvailable, doorPaymentSchema, evenementHasFee,
  evenementTicketPaymentSelect, markParticipationPaid, onSitePaymentMethodSchema, type DoorPayment,
} from "@/lib/evenement-ticket-payment"
import { formatAddress } from "@/lib/address"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
// Narrower than MANAGERS on purpose — waiving a ticket's price is a judgment call an
// association may not want its Trésorier/Secrétaire making unilaterally, unlike simply
// recording a payment that already happened.
const FREE_MANAGERS = ["ADMIN", "PRESIDENT"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId },
    include: { ticketTypes: { select: { id: true, label: true } } },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  const ticketTypeLabels = new Map(evenement.ticketTypes.map(tt => [tt.id, tt.label]))

  // Only people with a real link to this event — a ticket, an RSVP, a companion, or a
  // guest added at the door. Used to list every active member here regardless of any of
  // that, so an admin could check someone in without adding them first — but that made
  // every event look like the whole membership roster was "in" it, especially once bulk
  // imports (e.g. AssoConnect) swelled the active member count. Finding and adding a
  // member now lives in the "Ajouter un membre" search instead (see the presences page),
  // which still creates a Participation lazily via POST below — presence itself is a
  // separate, deliberate click, same as any other row.
  const participations = await prisma.participation.findMany({
    where:  { evenementId },
    select: { id: true, membreId: true, firstName: true, lastName: true, email: true, phone: true, address: true, addressStreet: true, addressComplement: true, postalCode: true, city: true, country: true, answers: true, present: true, rsvp: true, ticketPaidAt: true, amount: true, stripeSessionId: true, ticketTypeId: true, receiptMode: true, paymentMethod: true },
  })

  const rows = participations
    .map(p => ({
      participationId: p.id,
      membreId:        p.membreId,
      firstName:       p.firstName,
      lastName:        p.lastName,
      email:           p.email,
      phone:           p.phone,
      // Une seule chaîne lisible, quelle que soit la forme stockée : les colonnes
      // structurées quand elles existent, le texte libre hérité sinon. La page présences
      // (fiche d'inscription, export PDF) n'a donc rien à recomposer elle-même.
      address:         formatAddress({ street: p.addressStreet, complement: p.addressComplement, postalCode: p.postalCode, city: p.city, country: p.country, legacy: p.address }),
      answers:         p.answers,
      present:         p.present,
      rsvp:            p.rsvp,
      ticketPaidAt:    p.ticketPaidAt,
      amount:          p.amount,
      stripeSessionId: p.stripeSessionId,
      ticketTypeLabel: p.ticketTypeId ? (ticketTypeLabels.get(p.ticketTypeId) ?? null) : null,
      isGuest:         p.membreId == null,
      receiptMode:     p.receiptMode,
      ticketTypeId:    p.ticketTypeId,
      paymentMethod:   p.paymentMethod,
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

  return NextResponse.json(rows)
})

const markPaidBodySchema = z.object({
  participationId: z.string().min(1).optional(),
  membreId:        z.string().min(1).optional(),
  ticketTypeId:    z.string().min(1).optional(),
  free:            z.boolean().optional(),
  // Absent = previous behaviour (the method chosen at registration, else espèces).
  paymentMethod:   onSitePaymentMethodSchema.optional(),
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const parsedBody = markPaidBodySchema.safeParse(await req.json())
  if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error.issues }, { status: 422 })
  const { participationId, membreId, ticketTypeId, free, paymentMethod } = parsedBody.data

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: evenementTicketPaymentSelect,
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (!evenementHasFee(evenement))
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })

  let participation
  if (participationId) {
    participation = await prisma.participation.findFirst({ where: { id: participationId, evenementId } })
    if (!participation) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })
  } else if (membreId) {
    const membre = await prisma.membre.findFirst({ where: { id: membreId, associationId, deletedAt: null } })
    if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
    participation = await prisma.participation.findFirst({ where: { membreId, evenementId } })
    if (!participation) {
      participation = await prisma.participation.create({
        data: { associationId, membreId, evenementId, firstName: membre.firstName, lastName: membre.lastName, email: membre.email },
      })
    }
  } else {
    return NextResponse.json({ error: "participationId ou membreId requis" }, { status: 422 })
  }

  if (participation.ticketPaidAt)
    return NextResponse.json({ error: "Déjà marqué comme payé" }, { status: 409 })

  const paidAt = new Date()

  // Ad-hoc exemption (VIP, staff, speaker…) — an admin override distinct from a €0 tarif:
  // a free MembershipTier-style entry would be publicly selectable by anyone registering,
  // while this only ever applies to the one row it's clicked on. No amount, no tier, no
  // Income — there's no real payment to reconcile, unlike every other branch below.
  if (free) {
    if (!FREE_MANAGERS.includes(role))
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    // Clears any tier the registration had already picked (public form, portal, or a
    // previous manual assignment) — otherwise the row would show both a specific paid
    // tarif's label and the "Gratuit" badge at once, implying a price that was never
    // actually charged.
    const updated = await prisma.participation.update({
      where: { id: participation.id },
      data:  { ticketPaidAt: paidAt, amount: 0, ticketTypeId: null, receiptMode: "NONE", deductibleAmount: null },
    })

    await writeActivityLog({
      associationId,
      actorId:  userId,
      action:   "TICKET_MARKED_FREE",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { memberName: `${participation.firstName} ${participation.lastName}` },
    })

    return NextResponse.json(updated)
  }

  const exercice = await resolveExerciceForDate(associationId, paidAt)
  const exerciceGuard = closedExerciceGuard(exercice?.status)
  if (exerciceGuard) return exerciceGuard

  const participationToPay = participation
  let updated
  try {
    updated = await prisma.$transaction(transaction => markParticipationPaid(transaction, {
      associationId,
      evenement,
      participation: participationToPay,
      ticketTypeId,
      paymentMethod,
      paidAt,
      exerciceId: exercice?.id ?? null,
    }))
  } catch (error) {
    if (error instanceof TicketPaymentError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "TICKET_PAID",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { memberName: `${participation.firstName} ${participation.lastName}`, paymentMethod: updated.paymentMethod },
  })

  return NextResponse.json(updated)
})

const presenceBodySchema = z.object({
  participationId: z.string().min(1).optional(),
  membreId:        z.string().min(1).optional(),
  present:         z.boolean(),
  payment:         doorPaymentSchema.optional(),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const parsedBody = presenceBodySchema.safeParse(await req.json())
  if (!parsedBody.success) return NextResponse.json({ error: parsedBody.error.issues }, { status: 422 })
  const { participationId, membreId, present, payment } = parsedBody.data

  // "Ajouter un membre" with a payment choice (paid event) — creation + payment/reservation in
  // one transaction, see addMemberWithPayment below.
  if (payment) {
    if (!membreId) return NextResponse.json({ error: "membreId requis" }, { status: 422 })
    return addMemberWithPayment({ associationId, userId, evenementId, evenement, membreId, present, payment })
  }

  let participation
  let justCreated = false
  if (participationId) {
    participation = await prisma.participation.findFirst({ where: { id: participationId, evenementId } })
    if (!participation) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })
  } else if (membreId) {
    const membre = await prisma.membre.findFirst({ where: { id: membreId, associationId, deletedAt: null } })
    if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
    participation = await prisma.participation.findFirst({ where: { membreId, evenementId } })
    if (!participation) {
      // Adding a member to the list is allowed until the event is over (late arrivals at the
      // door); toggling presence on an existing row stays possible afterwards.
      if (isEvenementOver(evenement))
        return NextResponse.json({ error: "Impossible de modifier la liste d'un événement déjà passé." }, { status: 422 })
      participation = await prisma.participation.create({
        data: { associationId, membreId, evenementId, firstName: membre.firstName, lastName: membre.lastName, email: membre.email },
      })
      justCreated = true
    }
  } else {
    return NextResponse.json({ error: "participationId ou membreId requis" }, { status: 422 })
  }

  // Une personne en liste d'attente n'a jamais reçu de place confirmée — la cocher présente
  // directement contournerait la capacité sans jamais repasser par "Promouvoir" (qui, lui,
  // revérifie la capacité au moment où ça compte). Doit d'abord être promue.
  if (present && participation.rsvp === "LISTA_ESPERA") {
    return NextResponse.json({ error: "Cette personne est en liste d'attente — promouvez-la d'abord." }, { status: 422 })
  }

  if (present && evenement.capacity != null) {
    const occupied = await prisma.participation.count({
      where: { evenementId, present: true, id: { not: participation.id } },
    })
    if (occupied + 1 > evenement.capacity) {
      return NextResponse.json({ error: "Capacité maximale atteinte" }, { status: 422 })
    }
  }

  const wasPresent = participation.present

  const updated = await prisma.participation.update({
    where: { id: participation.id },
    data:  { present },
  })

  // Logged even when present stays false (the "Ajouter un membre" search on the presences
  // page never auto-checks someone in — see that page's handleAddMember) — otherwise
  // adding a member here left no trace at all, unlike the guest-add endpoint's own
  // PARTICIPANT_ADDED entry.
  if (justCreated) {
    await writeActivityLog({
      associationId,
      actorId:  userId,
      action:   "PARTICIPANT_ADDED",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { memberName: `${participation.firstName} ${participation.lastName}` },
    })
  }

  if (wasPresent !== present) {
    await writeActivityLog({
      associationId,
      actorId:  userId,
      action:   "PRESENCE_MARKED",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { present, memberName: `${participation.firstName} ${participation.lastName}` },
    })
  }

  return NextResponse.json(updated)
})

async function addMemberWithPayment(params: {
  associationId: string
  userId:        string
  evenementId:   string
  evenement:     { title: string; capacity: number | null; date: Date; endDate: Date | null }
  membreId:      string
  present:       boolean
  payment:       DoorPayment
}) {
  const { associationId, userId, evenementId, evenement, membreId, present, payment } = params

  const evenementForPayment = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: evenementTicketPaymentSelect,
  })
  if (!evenementForPayment) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (!evenementHasFee(evenementForPayment))
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })

  const membre = await prisma.membre.findFirst({ where: { id: membreId, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existing = await prisma.participation.findFirst({ where: { membreId, evenementId } })
  if (!existing && isEvenementOver(evenement))
    return NextResponse.json({ error: "Impossible de modifier la liste d'un événement déjà passé." }, { status: 422 })
  if (existing?.rsvp === "LISTA_ESPERA")
    return NextResponse.json({ error: "Cette personne est en liste d'attente — promouvez-la d'abord." }, { status: 422 })

  const paidAt = new Date()
  let exerciceId: string | null = null
  if (payment.mode === "now") {
    const exercice = await resolveExerciceForDate(associationId, paidAt)
    const exerciceGuard = closedExerciceGuard(exercice?.status)
    if (exerciceGuard) return exerciceGuard
    exerciceId = exercice?.id ?? null
  }

  let updated
  try {
    updated = await prisma.$transaction(async transaction => {
      const alreadyHoldsSeat = !!existing && (existing.ticketPaidAt != null || existing.rsvp === "CONFIRME")
      if (!alreadyHoldsSeat)
        await assertSeatAvailable(transaction, { evenementId, capacity: evenement.capacity, participationId: existing?.id })

      const participation = existing ?? await transaction.participation.create({
        data: { associationId, membreId, evenementId, firstName: membre.firstName, lastName: membre.lastName, email: membre.email },
      })
      const withPayment = await applyDoorPayment(transaction, {
        associationId, evenement: evenementForPayment, participation, payment, paidAt, exerciceId,
      })
      if (withPayment.present === present) return withPayment
      return transaction.participation.update({ where: { id: participation.id }, data: { present } })
    })
  } catch (error) {
    if (error instanceof TicketPaymentError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }

  const memberName = `${membre.firstName} ${membre.lastName}`
  if (!existing) {
    await writeActivityLog({
      associationId, actorId: userId, action: "PARTICIPANT_ADDED", entity: "Participation",
      entityId: updated.id, label: evenement.title, metadata: { memberName },
    })
  }
  if (payment.mode === "now") {
    await writeActivityLog({
      associationId, actorId: userId, action: "TICKET_PAID", entity: "Participation",
      entityId: updated.id, label: evenement.title, metadata: { memberName, paymentMethod: updated.paymentMethod },
    })
  }
  if ((existing?.present ?? false) !== present) {
    await writeActivityLog({
      associationId, actorId: userId, action: "PRESENCE_MARKED", entity: "Participation",
      entityId: updated.id, label: evenement.title, metadata: { present, memberName },
    })
  }

  return NextResponse.json(updated)
}

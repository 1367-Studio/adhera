import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"

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
    select: { id: true, membreId: true, firstName: true, lastName: true, email: true, phone: true, address: true, answers: true, present: true, rsvp: true, ticketPaidAt: true, amount: true, stripeSessionId: true, ticketTypeId: true },
  })

  const rows = participations
    .map(p => ({
      participationId: p.id,
      membreId:        p.membreId,
      firstName:       p.firstName,
      lastName:        p.lastName,
      email:           p.email,
      phone:           p.phone,
      address:         p.address,
      answers:         p.answers,
      present:         p.present,
      rsvp:            p.rsvp,
      ticketPaidAt:    p.ticketPaidAt,
      amount:          p.amount,
      stripeSessionId: p.stripeSessionId,
      ticketTypeLabel: p.ticketTypeId ? (ticketTypeLabels.get(p.ticketTypeId) ?? null) : null,
      isGuest:         p.membreId == null,
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

  return NextResponse.json(rows)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { participationId, membreId, ticketTypeId, free } = await req.json() as { participationId?: string; membreId?: string; ticketTypeId?: string; free?: boolean }

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { title: true, price: true, ticketTypes: { select: { id: true, label: true, price: true } } },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  const hasTicketTypes = evenement.ticketTypes.length > 0
  if (!hasTicketTypes && (!evenement.price || Number(evenement.price) === 0))
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
        data: { membreId, evenementId, firstName: membre.firstName, lastName: membre.lastName, email: membre.email },
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
      data:  { ticketPaidAt: paidAt, amount: 0, ticketTypeId: null },
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

  // Which tier to charge: an explicit choice from the request wins (the "choose a tier"
  // modal in the presences UI, for a walk-in that was never given one); otherwise fall back
  // to whatever this registration already picked (public form, portal purchase, or a
  // previous manual assignment); a single-tier event has no ambiguity so needs neither.
  // More than one tier and nothing resolved means the caller must pick — never guess.
  let tier: { id: string; label: string; price: unknown } | undefined
  if (hasTicketTypes) {
    if (ticketTypeId) {
      tier = evenement.ticketTypes.find(tt => tt.id === ticketTypeId)
      if (!tier) return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })
    } else if (participation.ticketTypeId) {
      tier = evenement.ticketTypes.find(tt => tt.id === participation.ticketTypeId)
    } else if (evenement.ticketTypes.length === 1) {
      tier = evenement.ticketTypes[0]
    } else {
      return NextResponse.json({ error: "Sélectionnez un tarif" }, { status: 422 })
    }
  }
  const amount = hasTicketTypes ? Number(tier!.price) : Number(evenement.price)

  const exercice = await resolveExerciceForDate(associationId, paidAt)
  const exerciceGuard = closedExerciceGuard(exercice?.status)
  if (exerciceGuard) return exerciceGuard

  const updated = await prisma.participation.update({
    where: { id: participation.id },
    data:  { ticketPaidAt: paidAt, amount, ticketTypeId: tier?.id },
  })

  const ticketLabel = evenement.ticketTypes.length > 1 && tier ? ` (${tier.label})` : ""
  await prisma.income.create({
    data: {
      associationId,
      exerciceId:      exercice?.id ?? null,
      memberId:        participation.membreId,
      participationId: participation.id,
      amount,
      description: `Billet (espèces) — ${evenement.title}${ticketLabel} — ${participation.firstName} ${participation.lastName}`,
      source:      "MANUAL",
      status:      "PAID",
      date:        paidAt,
    },
  })

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "TICKET_PAID",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { memberName: `${participation.firstName} ${participation.lastName}` },
  })

  return NextResponse.json(updated)
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const { participationId, membreId, present } = await req.json() as { participationId?: string; membreId?: string; present: boolean }

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
      participation = await prisma.participation.create({
        data: { membreId, evenementId, firstName: membre.firstName, lastName: membre.lastName, email: membre.email },
      })
      justCreated = true
    }
  } else {
    return NextResponse.json({ error: "participationId ou membreId requis" }, { status: 422 })
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

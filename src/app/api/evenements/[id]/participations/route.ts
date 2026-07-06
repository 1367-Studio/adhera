import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  // Active members are offered as one-click walk-in targets even without a prior RSVP.
  // Every other Participation row (a member's named companions, a non-ACTIF member's
  // own ticket, or a guest added directly at the door) is merged in on top so nobody
  // with a real ticket is ever invisible from the check-in list.
  const [activeMembres, participations] = await Promise.all([
    prisma.membre.findMany({
      where:   { associationId, deletedAt: null, status: "ACTIF" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select:  { id: true, firstName: true, lastName: true },
    }),
    prisma.participation.findMany({
      where:  { evenementId },
      select: { id: true, membreId: true, firstName: true, lastName: true, email: true, present: true, rsvp: true, ticketPaidAt: true, stripeSessionId: true },
    }),
  ])

  const byMembre        = new Map(participations.filter(p => p.membreId).map(p => [p.membreId as string, p]))
  const activeMembreIds = new Set(activeMembres.map(m => m.id))

  const rows = [
    ...activeMembres.map(m => {
      const p = byMembre.get(m.id)
      return {
        participationId: p?.id ?? null,
        membreId:        m.id,
        firstName:       m.firstName,
        lastName:        m.lastName,
        email:           p?.email ?? null,
        present:         p?.present ?? false,
        rsvp:            p?.rsvp ?? null,
        ticketPaidAt:    p?.ticketPaidAt ?? null,
        stripeSessionId: p?.stripeSessionId ?? null,
        isGuest:         false,
      }
    }),
    ...participations
      .filter(p => !p.membreId || !activeMembreIds.has(p.membreId))
      .map(p => ({
        participationId: p.id,
        membreId:        p.membreId,
        firstName:       p.firstName,
        lastName:        p.lastName,
        email:           p.email,
        present:         p.present,
        rsvp:            p.rsvp,
        ticketPaidAt:    p.ticketPaidAt,
        stripeSessionId: p.stripeSessionId,
        isGuest:         p.membreId == null,
      })),
  ].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

  return NextResponse.json(rows)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { participationId, membreId } = await req.json() as { participationId?: string; membreId?: string }

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { title: true, price: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (!evenement.price || Number(evenement.price) === 0)
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
  const amount = Number(evenement.price)

  const updated = await prisma.participation.update({
    where: { id: participation.id },
    data:  { ticketPaidAt: paidAt, amount },
  })

  await prisma.income.create({
    data: {
      associationId,
      memberId:        participation.membreId,
      participationId: participation.id,
      amount,
      description: `Billet (espèces) — ${evenement.title} — ${participation.firstName} ${participation.lastName}`,
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

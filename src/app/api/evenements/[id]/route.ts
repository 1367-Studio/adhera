import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeDiff } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({
    where: { id, associationId },
    include: {
      participations: {
        include: { membre: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { membre: { lastName: "asc" } },
      },
      _count: { select: { participations: { where: { present: true } } } },
    },
  })

  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  return NextResponse.json(evenement)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = evenementUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, endDate, description, location, lat, lng, price, capacity, ...rest } = parsed.data

  if (capacity != null) {
    const reservedParticipations = await prisma.participation.findMany({
      where:  { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
      select: { quantity: true, paidQuantity: true },
    })
    const reserved = reservedParticipations.reduce((sum, p) => sum + (p.paidQuantity ?? p.quantity), 0)
    if (capacity < reserved) {
      return NextResponse.json(
        { error: `Impossible : ${reserved} place(s) déjà réservée(s) ou payée(s)` },
        { status: 409 },
      )
    }
  }

  const evenement = await prisma.evenement.update({
    where: { id },
    data: {
      ...rest,
      ...(date        ? { date:        new Date(date)    } : {}),
      ...(endDate     !== undefined ? { endDate:     endDate     ? new Date(endDate)  : null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(location    !== undefined ? { location:    location    || null } : {}),
      ...(lat         !== undefined ? { lat }                              : {}),
      ...(lng         !== undefined ? { lng }                              : {}),
      ...(price       !== undefined ? { price:    price    ?? null }       : {}),
      ...(capacity    !== undefined ? { capacity: capacity ?? null }       : {}),
    },
  })

  const changes = computeDiff(
    existing  as Record<string, unknown>,
    evenement as Record<string, unknown>,
    ["title", "date", "location", "price", "capacity"],
  )
  await writeActivityLog({ associationId, actorId: userId, action: "EVENEMENT_UPDATED", entity: "Evenement", entityId: id, label: evenement.title, metadata: Object.keys(changes).length > 0 ? { changes } : undefined })
  return NextResponse.json(evenement)
}, { roles: MANAGERS, module: "evenements" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const participationCount = await prisma.participation.count({ where: { evenementId: id } })
  if (participationCount > 0) {
    return NextResponse.json(
      { error: `Impossible de supprimer : ${participationCount} membre(s) ont une réponse ou un billet pour cet événement.` },
      { status: 409 },
    )
  }

  await prisma.evenement.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "EVENEMENT_DELETED", entity: "Evenement", entityId: id, label: existing.title })
  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "evenements" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementTicketTypesSchema } from "@/lib/schemas/evenement"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

class TicketTypeInUseError extends Error {}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId }, select: { id: true } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const ticketTypes = await prisma.evenementTicketType.findMany({
    where:   { evenementId: id },
    orderBy: { order: "asc" },
  })

  const occupancy = ticketTypes.length
    ? await prisma.participation.groupBy({
        by:     ["ticketTypeId"],
        where:  { ticketTypeId: { in: ticketTypes.map(tt => tt.id) }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        _count: { _all: true },
      })
    : []
  const occupiedMap = new Map(occupancy.map(o => [o.ticketTypeId, o._count._all]))

  return NextResponse.json(ticketTypes.map(tt => ({ ...tt, occupied: occupiedMap.get(tt.id) ?? 0 })))
})

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = evenementTicketTypesSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  let ticketTypes
  try {
    ticketTypes = await prisma.$transaction(async (tx) => {
      // Upsert by id (scoped to this event) instead of delete-all/recreate-all — same reasoning
      // as the custom-fields route: recreating would mint fresh ids and orphan any
      // Participation.ticketTypeId already pointing at the old rows.
      const existing     = await tx.evenementTicketType.findMany({ where: { evenementId: id }, select: { id: true } })
      const existingIds  = new Set(existing.map(f => f.id))
      const incomingIds  = new Set(parsed.data.filter(f => f.id).map(f => f.id))

      const toDelete = [...existingIds].filter(fid => !incomingIds.has(fid))
      if (toDelete.length) {
        // Removing a tier that someone already registered/paid under would silently orphan
        // their Participation.ticketTypeId (amount stays correct, but the tier label/link is
        // lost for reporting) — block it instead, same as rejecting a free/past event
        // elsewhere in this codebase, rather than letting it happen unnoticed.
        const inUse = await tx.participation.count({ where: { ticketTypeId: { in: toDelete } } })
        if (inUse > 0) throw new TicketTypeInUseError()
        await tx.evenementTicketType.deleteMany({ where: { id: { in: toDelete } } })
      }

      for (const [order, f] of parsed.data.entries()) {
        if (f.id && existingIds.has(f.id)) {
          await tx.evenementTicketType.update({
            where: { id: f.id },
            data:  { label: f.label, price: f.price, capacity: f.capacity ?? null, order },
          })
        } else {
          await tx.evenementTicketType.create({
            data: { evenementId: id, label: f.label, price: f.price, capacity: f.capacity ?? null, order },
          })
        }
      }

      return tx.evenementTicketType.findMany({ where: { evenementId: id }, orderBy: { order: "asc" } })
    })
  } catch (err) {
    if (err instanceof TicketTypeInUseError) {
      return NextResponse.json({ error: "Impossible de supprimer un tarif déjà utilisé par une inscription." }, { status: 422 })
    }
    throw err
  }

  await writeActivityLog({
    associationId, actorId: userId, action: "EVENEMENT_UPDATED", entity: "Evenement", entityId: id,
    label: evenement.title, metadata: { ticketTypesCount: ticketTypes.length },
  })

  return NextResponse.json(ticketTypes)
}, { roles: MANAGERS, module: "evenements" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementTicketTypesSchema } from "@/lib/schemas/evenement"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"

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
  let affectedDiscountCodes: string[] = []
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
        // Un code promo ciblant une tarif supprimée ne doit pas bloquer la suppression (voir
        // le commentaire de ticketTypeIds dans schema.prisma — le code cesse juste de
        // s'appliquer), mais l'admin doit au moins le savoir plutôt que le découvrir plus tard.
        const affected = await tx.evenementDiscountCode.findMany({
          where:  { evenementId: id, ticketTypeIds: { hasSome: toDelete } },
          select: { code: true },
        })
        affectedDiscountCodes = affected.map(d => d.code)
        await tx.evenementTicketType.deleteMany({ where: { id: { in: toDelete } } })
      }

      for (const [order, f] of parsed.data.entries()) {
        const ineligibleAmount = f.receiptMode === "PARTIAL" ? (f.ineligibleAmount ?? null) : null
        const priceBeforeDiscount = f.priceBeforeDiscount ?? null
        // Une tarif DONATION n'a jamais de capacité propre — même contrainte que
        // MembershipTier, déjà validée côté Zod, appliquée ici aussi pour ne jamais dépendre
        // uniquement du client.
        const capacity = f.itemType === "DONATION" ? null : (f.capacity ?? null)
        const opensAt  = f.opensAt  ? new Date(f.opensAt)  : null
        const closesAt = f.closesAt ? new Date(f.closesAt) : null
        if (f.id && existingIds.has(f.id)) {
          await tx.evenementTicketType.update({
            where: { id: f.id },
            data:  { itemType: f.itemType, label: f.label, price: f.price, priceBeforeDiscount, capacity, order, receiptMode: f.receiptMode, ineligibleAmount, active: f.active, opensAt, closesAt },
          })
        } else {
          await tx.evenementTicketType.create({
            data: { evenementId: id, itemType: f.itemType, label: f.label, price: f.price, priceBeforeDiscount, capacity, order, receiptMode: f.receiptMode, ineligibleAmount, active: f.active, opensAt, closesAt },
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
  await revalidatePublicSiteFor(associationId)

  await writeActivityLog({
    associationId, actorId: userId, action: "EVENEMENT_UPDATED", entity: "Evenement", entityId: id,
    label: evenement.title, metadata: { ticketTypesCount: ticketTypes.length },
  })

  return NextResponse.json({ ticketTypes, affectedDiscountCodes })
}, { roles: MANAGERS, module: "evenements" })

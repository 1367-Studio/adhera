import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

type EvenementWithTicketTypes = { ticketTypes: { id: string; label: string; price: unknown; capacity: number | null; active: boolean }[] }

// Shared by both the unpaginated (calendar) and paginated (list) branches below — merges
// each tier's live occupancy into `remaining`/`full`, same shape the public/portal routes
// already expose, so the admin list can show "complet" and compute an accurate cheapest price.
async function withTicketTypeOccupancy<T extends EvenementWithTicketTypes>(events: T[]) {
  const cappedIds = events.flatMap(e => e.ticketTypes).filter(tt => tt.capacity != null).map(tt => tt.id)
  const occupancy = cappedIds.length
    ? await prisma.participation.groupBy({
        by:     ["ticketTypeId"],
        where:  { ticketTypeId: { in: cappedIds }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        _count: { _all: true },
      })
    : []
  const occupiedMap = new Map(occupancy.map(o => [o.ticketTypeId, o._count._all]))
  return events.map(e => ({
    ...e,
    ticketTypes: e.ticketTypes.map(tt => {
      const remaining = tt.capacity != null ? Math.max(0, tt.capacity - (occupiedMap.get(tt.id) ?? 0)) : null
      return { ...tt, remaining, full: remaining === 0 }
    }),
  }))
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search    = searchParams.get("search")?.trim()
  const upcoming  = searchParams.get("upcoming") === "true"

  const from = searchParams.get("from")
  const to   = searchParams.get("to")

  const where: Record<string, unknown> = { associationId }
  if (upcoming) where.date = { gte: new Date() }
  else if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    }
  }
  if (search) {
    where.OR = [
      { title:    { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
    ]
  }

  const orderBy = upcoming
    ? { date: "asc" as const }
    : { date: "desc" as const }

  if (!searchParams.has("page")) {
    const data = await prisma.evenement.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        _count:      { select: { participations: { where: { present: true } } } },
        ticketTypes: { orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true, active: true } },
      },
    })
    return NextResponse.json(await withTicketTypeOccupancy(data))
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.evenement.findMany({
      where, orderBy, skip, take: limit,
      include: {
        _count:      { select: { participations: { where: { present: true } } } },
        ticketTypes: { orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true, active: true } },
      },
    }),
    prisma.evenement.count({ where }),
  ])

  const ids = data.map(e => e.id)
  const confirmedGroups = ids.length > 0
    ? await prisma.participation.groupBy({
        by:     ["evenementId"],
        where:  { evenementId: { in: ids }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        _count: { _all: true },
      })
    : []
  const confirmedMap = Object.fromEntries(confirmedGroups.map(g => [g.evenementId, g._count._all]))
  const withOccupancy = await withTicketTypeOccupancy(data)
  const enriched = withOccupancy.map(e => ({ ...e, confirmedCount: confirmedMap[e.id] ?? 0 }))

  return NextResponse.json({ data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) })
})

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json()
  const parsed = evenementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // conditions/attachments/requireCguvSignature never come through the "quick create"
  // title+date modal that hits this route — configured afterward from the wizard's own
  // "Informações gerais" step (PATCH) — so they're left out of `rest`/`data` entirely rather
  // than fighting Prisma's stricter JSON-create typing (a bare `null` for `attachments` isn't
  // assignable to its create input, unlike its update input).
  const { date, endDate, description, imageUrl, location, lat, lng, price, capacity, adminNotificationEmail, conditions: _conditions, attachments: _attachments, requireCguvSignature: _requireCguvSignature, ...rest } = parsed.data
  const evenement = await prisma.evenement.create({
    data: {
      ...rest,
      associationId,
      date:        new Date(date),
      endDate:     endDate  ? new Date(endDate)  : null,
      description: description || null,
      imageUrl:    imageUrl    || null,
      location:    location    || null,
      lat:         lat      ?? null,
      lng:         lng      ?? null,
      price:       price    ?? null,
      capacity:    capacity ?? null,
      adminNotificationEmail: adminNotificationEmail || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "EVENEMENT_CREATED", entity: "Evenement", entityId: evenement.id, label: evenement.title })

  // No member notification and no public-site revalidation here anymore — the event is
  // created DRAFT (see Evenement.status default) and isn't visible to anyone yet. Both now
  // happen in POST /api/evenements/[id]/publish, only on the actual DRAFT/ARCHIVED→PUBLISHED
  // transition, so an admin can freely configure an event without spamming every member.

  return NextResponse.json(evenement, { status: 201 })
}, { roles: MANAGERS, module: "evenements" })

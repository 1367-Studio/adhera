import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { revalidatePublicSite } from "@/lib/association/revalidate-site"
import { APP_TIME_ZONE } from "@/lib/date-format"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

type EvenementWithTicketTypes = { ticketTypes: { id: string; label: string; price: unknown; capacity: number | null }[] }

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
        ticketTypes: { orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true } },
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
        ticketTypes: { orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true } },
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

  const { date, endDate, description, imageUrl, location, lat, lng, price, capacity, adminNotificationEmail, ...rest } = parsed.data
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

  // Notify all active members with portal access
  const pusherReady = !!(process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET)
  const [members, association] = await Promise.all([
    prisma.membre.findMany({
      where:  { associationId, deletedAt: null, status: "ACTIF", userId: { not: null } },
      select: { userId: true },
    }),
    prisma.association.findUnique({ where: { id: associationId }, select: { slug: true } }),
  ])
  if (association) revalidatePublicSite(association.slug)
  const notifDateStr = evenement.date.toLocaleDateString("fr-FR", { timeZone: APP_TIME_ZONE, weekday: "long", day: "numeric", month: "long" })
  const notifBody    = [notifDateStr, evenement.location].filter(Boolean).join(" · ")
  void (async () => {
    await prisma.notification.createMany({
      data: members.map(m => ({ userId: m.userId!, title: evenement.title, body: notifBody || null, link: `/portal/${association?.slug}/evenements` })),
      skipDuplicates: true,
    })
    if (pusherReady) {
      await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {})
    }
  })()

  return NextResponse.json(evenement, { status: 201 })
}, { roles: MANAGERS, module: "evenements" })

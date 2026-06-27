import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { evenementSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
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
      include: { _count: { select: { participations: { where: { present: true } } } } },
    })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.evenement.findMany({
      where, orderBy, skip, take: limit,
      include: { _count: { select: { participations: { where: { present: true } } } } },
    }),
    prisma.evenement.count({ where }),
  ])

  const ids = data.map(e => e.id)
  const confirmedGroups = ids.length > 0
    ? await prisma.participation.groupBy({
        by:    ["evenementId"],
        where: { evenementId: { in: ids }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        _sum:  { quantity: true },
      })
    : []
  const confirmedMap = Object.fromEntries(confirmedGroups.map(g => [g.evenementId, g._sum.quantity ?? 0]))
  const enriched = data.map(e => ({ ...e, confirmedCount: confirmedMap[e.id] ?? 0 }))

  return NextResponse.json({ data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) })
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = evenementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, endDate, description, location, lat, lng, price, capacity, ...rest } = parsed.data
  const evenement = await prisma.evenement.create({
    data: {
      ...rest,
      associationId,
      date:        new Date(date),
      endDate:     endDate  ? new Date(endDate)  : null,
      description: description || null,
      location:    location    || null,
      lat:         lat      ?? null,
      lng:         lng      ?? null,
      price:       price    ?? null,
      capacity:    capacity ?? null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "EVENEMENT_CREATED", entity: "Evenement", entityId: evenement.id, label: evenement.title })

  // Notify all active members with portal access
  const pusherReady = !!(process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET)
  const members = await prisma.membre.findMany({
    where:  { associationId, deletedAt: null, status: "ACTIF", userId: { not: null } },
    select: { userId: true },
  })
  const notifDateStr = evenement.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
  const notifBody    = [notifDateStr, evenement.location].filter(Boolean).join(" · ")
  void Promise.all(
    members.map(async m => {
      const notif = await prisma.notification.create({
        data: { userId: m.userId!, title: evenement.title, body: notifBody || null, link: "/portal/evenements" },
      })
      if (pusherReady) {
        await pusherServer.trigger(`user-${m.userId}`, "new-notification", { id: notif.id })
      }
    }),
  )

  return NextResponse.json(evenement, { status: 201 })
}

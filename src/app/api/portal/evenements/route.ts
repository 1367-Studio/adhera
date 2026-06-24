import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string; associationId?: string | null }

type RsvpCounts = { CONFIRME: number; PROVAVEL: number; INCERTO: number; ABSENT: number }

async function getRsvpCounts(evenementIds: string[]): Promise<Record<string, RsvpCounts>> {
  if (!evenementIds.length) return {}

  const groups = await prisma.participation.groupBy({
    by:    ["evenementId", "rsvp"],
    where: { evenementId: { in: evenementIds }, rsvp: { not: null } },
    _count: { _all: true },
  })

  const result: Record<string, RsvpCounts> = {}
  for (const id of evenementIds) {
    result[id] = { CONFIRME: 0, PROVAVEL: 0, INCERTO: 0, ABSENT: 0 }
  }
  for (const g of groups) {
    if (g.rsvp) result[g.evenementId][g.rsvp] = g._count._all
  }
  return result
}

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const now = new Date()
  const participationSelect = {
    where:  { membre: { userId: u.id! } },
    select: { present: true, rsvp: true, ticketPaidAt: true },
  }

  const LIMIT = 10

  const [upcomingRaw, pastRaw] = await Promise.all([
    prisma.evenement.findMany({
      where:   { associationId: u.associationId, date: { gte: now } },
      orderBy: { date: "asc" },
      take:    LIMIT + 1,
      include: { participations: participationSelect },
    }),
    prisma.evenement.findMany({
      where:   { associationId: u.associationId, date: { lt: now } },
      orderBy: { date: "desc" },
      take:    LIMIT + 1,
      include: { participations: participationSelect },
    }),
  ])

  const upcomingHasMore = upcomingRaw.length > LIMIT
  const pastHasMore     = pastRaw.length     > LIMIT
  const upcoming        = upcomingRaw.slice(0, LIMIT)
  const past            = pastRaw.slice(0, LIMIT)

  const allIds = [...upcoming, ...past].map(e => e.id)
  const rsvpCounts = await getRsvpCounts(allIds)

  const withCounts = (list: typeof upcoming) =>
    list.map(e => ({ ...e, rsvpCounts: rsvpCounts[e.id] }))

  return NextResponse.json({
    upcoming:        withCounts(upcoming),
    past:            withCounts(past),
    upcomingHasMore,
    pastHasMore,
  })
}

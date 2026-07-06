import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

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

async function getConfirmedCounts(evenementIds: string[]): Promise<Record<string, number>> {
  if (!evenementIds.length) return {}

  const groups = await prisma.participation.groupBy({
    by:    ["evenementId"],
    where: {
      evenementId: { in: evenementIds },
      OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
    },
    _count: { _all: true },
  })

  const result: Record<string, number> = {}
  for (const id of evenementIds) result[id] = 0
  for (const g of groups) result[g.evenementId] = g._count._all
  return result
}

async function getPartySizes(orderIds: string[]): Promise<Record<string, number>> {
  if (!orderIds.length) return {}
  const groups = await prisma.participation.groupBy({
    by:     ["orderId"],
    where:  { orderId: { in: orderIds } },
    _count: { _all: true },
  })
  return Object.fromEntries(groups.map(g => [g.orderId!, g._count._all]))
}

export const GET = withPortalAuth(async (_req, ctx) => {
  const { associationId, userId } = ctx

  const now = new Date()
  const participationSelect = {
    where:  { membre: { userId } },
    select: { present: true, rsvp: true, ticketPaidAt: true, orderId: true },
  }

  const LIMIT = 10

  const [upcomingRaw, pastRaw] = await Promise.all([
    prisma.evenement.findMany({
      where:   { associationId, date: { gte: now } },
      orderBy: { date: "asc" },
      take:    LIMIT + 1,
      include: { participations: participationSelect },
    }),
    prisma.evenement.findMany({
      where:   { associationId, date: { lt: now } },
      orderBy: { date: "desc" },
      take:    LIMIT + 1,
      include: { participations: participationSelect },
    }),
  ])

  const upcomingHasMore = upcomingRaw.length > LIMIT
  const pastHasMore     = pastRaw.length     > LIMIT
  const upcoming        = upcomingRaw.slice(0, LIMIT)
  const past            = pastRaw.slice(0, LIMIT)

  const allIds     = [...upcoming, ...past].map(e => e.id)
  const orderIds   = [...upcoming, ...past]
    .map(e => e.participations[0]?.orderId)
    .filter((id): id is string => !!id)
  const [rsvpCounts, confirmedCounts, partySizes] = await Promise.all([
    getRsvpCounts(allIds),
    getConfirmedCounts(allIds),
    getPartySizes(orderIds),
  ])

  const withCounts = (list: typeof upcoming) =>
    list.map(e => ({
      ...e,
      rsvpCounts:     rsvpCounts[e.id],
      confirmedCount: confirmedCounts[e.id],
      partySize:      e.participations[0]?.orderId ? (partySizes[e.participations[0].orderId] ?? 1) : 1,
    }))

  return NextResponse.json({
    upcoming:        withCounts(upcoming),
    past:            withCounts(past),
    upcomingHasMore,
    pastHasMore,
  })
}, { requireMembre: false })

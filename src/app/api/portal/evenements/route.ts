import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"

type RsvpCounts = { CONFIRME: number; PROVAVEL: number; INCERTO: number; ABSENT: number; LISTA_ESPERA: number }

async function getRsvpCounts(evenementIds: string[]): Promise<Record<string, RsvpCounts>> {
  if (!evenementIds.length) return {}

  const groups = await prisma.participation.groupBy({
    by:    ["evenementId", "rsvp"],
    where: { evenementId: { in: evenementIds }, rsvp: { not: null } },
    _count: { _all: true },
  })

  const result: Record<string, RsvpCounts> = {}
  for (const id of evenementIds) {
    result[id] = { CONFIRME: 0, PROVAVEL: 0, INCERTO: 0, ABSENT: 0, LISTA_ESPERA: 0 }
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

async function getTicketTypeOccupancy(ticketTypeIds: string[]): Promise<Record<string, number>> {
  if (!ticketTypeIds.length) return {}
  const groups = await prisma.participation.groupBy({
    by:     ["ticketTypeId"],
    where:  { ticketTypeId: { in: ticketTypeIds }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
    _count: { _all: true },
  })
  return Object.fromEntries(groups.map(g => [g.ticketTypeId!, g._count._all]))
}

export const GET = withPortalAuth(async (_req, ctx) => {
  const { associationId, userId } = ctx

  const now = new Date()
  const participationSelect = {
    where:  { membre: { userId } },
    select: { id: true, present: true, rsvp: true, ticketPaidAt: true, orderId: true, avis: { select: { id: true } } },
  }

  const LIMIT = 10

  // Inactive tiers (see EvenementTicketType.active) are invisible here just like on the
  // public form — same convention as inscription/route.ts's realTicketTypes filter, and
  // matches what the portal checkout route itself will actually accept.
  const ticketTypesSelect = { where: { active: true }, orderBy: { order: "asc" as const }, select: { id: true, label: true, price: true, capacity: true } }

  const [upcomingRaw, pastRaw] = await Promise.all([
    prisma.evenement.findMany({
      // No visibility filter here (unlike the public site route) — PRIVATE means "portal
      // only, not on the public site/link", so a member should still see it. DRAFT is
      // excluded either way: an admin still configuring the event isn't done announcing it.
      where:   { associationId, date: { gte: now }, status: "PUBLISHED" },
      orderBy: { date: "asc" },
      take:    LIMIT + 1,
      include: { participations: participationSelect, ticketTypes: ticketTypesSelect },
    }),
    prisma.evenement.findMany({
      where:   { associationId, date: { lt: now }, status: "PUBLISHED" },
      orderBy: { date: "desc" },
      take:    LIMIT + 1,
      include: { participations: participationSelect, ticketTypes: ticketTypesSelect },
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
  const cappedTicketTypeIds = [...upcoming, ...past]
    .flatMap(e => e.ticketTypes)
    .filter(tt => tt.capacity != null)
    .map(tt => tt.id)
  const [rsvpCounts, confirmedCounts, partySizes, ticketTypeOccupancy] = await Promise.all([
    getRsvpCounts(allIds),
    getConfirmedCounts(allIds),
    getPartySizes(orderIds),
    getTicketTypeOccupancy(cappedTicketTypeIds),
  ])

  const withCounts = (list: typeof upcoming) =>
    list.map(e => ({
      ...e,
      rsvpCounts:     rsvpCounts[e.id],
      confirmedCount: confirmedCounts[e.id],
      partySize:      e.participations[0]?.orderId ? (partySizes[e.participations[0].orderId] ?? 1) : 1,
      ticketTypes:    e.ticketTypes.map(tt => {
        const remaining = tt.capacity != null ? Math.max(0, tt.capacity - (ticketTypeOccupancy[tt.id] ?? 0)) : null
        return { ...tt, remaining, full: remaining === 0 }
      }),
    }))

  const upcomingWithCounts = withCounts(upcoming)
  const pastWithCounts     = withCounts(past)

  // One batched Azure call (cached per locale) covers title/description for every
  // event on the page instead of one call per event.
  const locale     = (await getLocale()) as Locale
  const translated = await translateFields([...upcomingWithCounts, ...pastWithCounts], ["title", "description"], locale)

  return NextResponse.json({
    upcoming:        translated.slice(0, upcomingWithCounts.length),
    past:            translated.slice(upcomingWithCounts.length),
    upcomingHasMore,
    pastHasMore,
  })
}, { requireMembre: false })

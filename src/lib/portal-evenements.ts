import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"

// Shared by the portal event list and the portal event detail route so a detail
// response is always exactly one element of the list response.

type RsvpCounts = { CONFIRME: number; PROVAVEL: number; INCERTO: number; ABSENT: number; LISTA_ESPERA: number }

export function participationSelect(userId: string) {
  return {
    where:  { membre: { userId } },
    select: { id: true, present: true, rsvp: true, ticketPaidAt: true, orderId: true, avis: { select: { id: true } } },
  } satisfies Prisma.Evenement$participationsArgs
}

// Inactive tiers (see EvenementTicketType.active) are invisible here just like on the
// public form — same convention as inscription/route.ts's realTicketTypes filter, and
// matches what the portal checkout route itself will actually accept.
export const ticketTypesSelect = {
  where:   { active: true },
  orderBy: { order: "asc" as const },
  select:  { id: true, label: true, price: true, capacity: true },
} satisfies Prisma.Evenement$ticketTypesArgs

export function portalEvenementInclude(userId: string) {
  return {
    participations: participationSelect(userId),
    ticketTypes:    ticketTypesSelect,
  } satisfies Prisma.EvenementInclude
}

export type PortalEvenementRow = Prisma.EvenementGetPayload<{ include: ReturnType<typeof portalEvenementInclude> }>

async function getRsvpCounts(evenementIds: string[]): Promise<Record<string, RsvpCounts>> {
  if (!evenementIds.length) return {}

  const groups = await prisma.participation.groupBy({
    by:    ["evenementId", "rsvp"],
    where: { evenementId: { in: evenementIds }, rsvp: { not: null } },
    _count: { _all: true },
  })

  const result: Record<string, RsvpCounts> = {}
  for (const evenementId of evenementIds) {
    result[evenementId] = { CONFIRME: 0, PROVAVEL: 0, INCERTO: 0, ABSENT: 0, LISTA_ESPERA: 0 }
  }
  for (const group of groups) {
    if (group.rsvp) result[group.evenementId][group.rsvp] = group._count._all
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
  for (const evenementId of evenementIds) result[evenementId] = 0
  for (const group of groups) result[group.evenementId] = group._count._all
  return result
}

async function getPartySizes(orderIds: string[]): Promise<Record<string, number>> {
  if (!orderIds.length) return {}
  const groups = await prisma.participation.groupBy({
    by:     ["orderId"],
    where:  { orderId: { in: orderIds } },
    _count: { _all: true },
  })
  return Object.fromEntries(groups.map(group => [group.orderId!, group._count._all]))
}

async function getTicketTypeOccupancy(ticketTypeIds: string[]): Promise<Record<string, number>> {
  if (!ticketTypeIds.length) return {}
  const groups = await prisma.participation.groupBy({
    by:     ["ticketTypeId"],
    where:  { ticketTypeId: { in: ticketTypeIds }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
    _count: { _all: true },
  })
  return Object.fromEntries(groups.map(group => [group.ticketTypeId!, group._count._all]))
}

// Adds rsvpCounts, confirmedCount, partySize and per-tier remaining/full, then translates
// ticket-type labels and title/description. Output order matches input order.
export async function enrichPortalEvenements(
  evenements:    PortalEvenementRow[],
  associationId: string,
  locale:        Locale,
) {
  const evenementIds = evenements.map(evenement => evenement.id)
  const orderIds     = evenements
    .map(evenement => evenement.participations[0]?.orderId)
    .filter((orderId): orderId is string => !!orderId)
  const cappedTicketTypeIds = evenements
    .flatMap(evenement => evenement.ticketTypes)
    .filter(ticketType => ticketType.capacity != null)
    .map(ticketType => ticketType.id)
  const [rsvpCounts, confirmedCounts, partySizes, ticketTypeOccupancy] = await Promise.all([
    getRsvpCounts(evenementIds),
    getConfirmedCounts(evenementIds),
    getPartySizes(orderIds),
    getTicketTypeOccupancy(cappedTicketTypeIds),
  ])

  const withCounts = evenements.map(evenement => ({
    ...evenement,
    rsvpCounts:     rsvpCounts[evenement.id],
    confirmedCount: confirmedCounts[evenement.id],
    partySize:      evenement.participations[0]?.orderId ? (partySizes[evenement.participations[0].orderId] ?? 1) : 1,
    ticketTypes:    evenement.ticketTypes.map(ticketType => {
      const remaining = ticketType.capacity != null ? Math.max(0, ticketType.capacity - (ticketTypeOccupancy[ticketType.id] ?? 0)) : null
      return { ...ticketType, remaining, full: remaining === 0 }
    }),
  }))

  // translateFields only maps the top-level string keys it's given — it doesn't recurse
  // into nested arrays — so ticket-type labels need their own batched call, separate from
  // title/description below. Mirrors the ticketTypes translation on the public event page.
  const flatTicketTypes       = withCounts.flatMap(evenement => evenement.ticketTypes)
  const translatedTicketTypes = await translateFields(flatTicketTypes, ["label"], locale, associationId)
  const translatedLabelById   = new Map(translatedTicketTypes.map(ticketType => [ticketType.id, ticketType.label]))
  const withTranslatedLabels  = withCounts.map(evenement => ({
    ...evenement,
    ticketTypes: evenement.ticketTypes.map(ticketType => ({ ...ticketType, label: translatedLabelById.get(ticketType.id) ?? ticketType.label })),
  }))

  // One batched Azure call (cached per locale) covers title/description for every
  // event on the page instead of one call per event.
  return translateFields(withTranslatedLabels, ["title", "description"], locale, associationId)
}

export type PortalEvenement = Awaited<ReturnType<typeof enrichPortalEvenements>>[number]

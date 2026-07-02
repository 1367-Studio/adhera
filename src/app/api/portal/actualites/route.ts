import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const DEFAULT_LIMIT = 20

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, userId } = ctx

  const { searchParams } = new URL(req.url)
  const page  = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10)))
  const skip  = (page - 1) * limit

  const membre = await prisma.membre.findFirst({
    where:  { userId, associationId, deletedAt: null },
    select: { id: true },
  })

  const where = {
    associationId,
    publishedAt: { not: null },
    OR: [
      { recipientMode: "ALL" },
      { recipientMode: "SELECTED", recipients: { some: { membreId: membre?.id ?? "" } } },
    ],
  }

  const [actualites, total] = await Promise.all([
    prisma.actualite.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      skip,
      take: limit,
      include: {
        evenement: {
          select: { id: true, title: true, date: true, endDate: true, location: true, lat: true, lng: true, price: true, description: true },
        },
      },
    }),
    prisma.actualite.count({ where }),
  ])

  // Fetch the member's RSVP for any linked events
  const evenementIds = actualites.map(a => a.evenementId).filter((id): id is string => !!id)
  const rsvpByEvenement: Record<string, string> = {}

  if (evenementIds.length > 0 && membre) {
    const participations = await prisma.participation.findMany({
      where:  { membreId: membre.id, evenementId: { in: evenementIds } },
      select: { evenementId: true, rsvp: true },
    })
    for (const p of participations) {
      if (p.rsvp) rsvpByEvenement[p.evenementId] = p.rsvp
    }
  }

  const data = actualites.map(a => ({
    ...a,
    evenementRsvp: a.evenementId ? (rsvpByEvenement[a.evenementId] ?? null) : null,
  }))

  return NextResponse.json({
    data,
    total,
    page,
    limit,
    hasMore: skip + actualites.length < total,
  })
}

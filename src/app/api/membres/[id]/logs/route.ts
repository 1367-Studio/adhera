import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const DEFAULT_PAGE_SIZE = 20

export const GET = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const membre = await prisma.membre.findFirst({
    where:  { id, associationId },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, Number(searchParams.get("page")     ?? 1)                    || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))

  const participations = await prisma.participation.findMany({
    where:  { membreId: id },
    select: { id: true },
  })
  const participationIds = participations.map(p => p.id)

  const where = {
    associationId,
    OR: [
      { entity: "Membre",        entityId: id },
      ...(participationIds.length > 0
        ? [{ entity: "Participation", entityId: { in: participationIds } }]
        : []),
    ],
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
    }),
    prisma.activityLog.count({ where }),
  ])

  const actorIds = [...new Set(logs.map(l => l.actorId).filter(Boolean) as string[])]
  const actors   = actorIds.length > 0
    ? await prisma.user.findMany({
        where:  { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : []

  const actorMap = Object.fromEntries(actors.map(u => [u.id, u.name ?? u.email ?? u.id]))

  const enriched = logs.map(l => ({
    ...l,
    actorName: l.actorId ? (actorMap[l.actorId] ?? null) : null,
  }))

  return NextResponse.json({
    data:       enriched,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    pageSize,
  })
})

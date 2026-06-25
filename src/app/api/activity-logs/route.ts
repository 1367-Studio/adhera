import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const PAGE_SIZE = 50

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, Number(searchParams.get("page") ?? 1) || 1)
  const action   = searchParams.get("action")   ?? undefined
  const entity   = searchParams.get("entity")   ?? undefined
  const entityId = searchParams.get("entityId") ?? undefined
  const actorId  = searchParams.get("actorId")  ?? undefined
  const from     = searchParams.get("from")
  const to       = searchParams.get("to")

  const toDate = to ? new Date(to) : null
  if (toDate) toDate.setUTCHours(23, 59, 59, 999)

  const where = {
    associationId,
    ...(action   && { action }),
    ...(entity   && { entity }),
    ...(entityId && { entityId }),
    ...(actorId  && { actorId }),
    ...((from || to) && {
      createdAt: {
        ...(from   && { gte: new Date(from) }),
        ...(toDate && { lte: toDate }),
      },
    }),
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
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
    totalPages: Math.ceil(total / PAGE_SIZE),
    pageSize:   PAGE_SIZE,
  })
}

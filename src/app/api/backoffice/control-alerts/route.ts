import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { parsePagination, type PaginatedResult } from "@/lib/pagination"

// Shared with ./[id]/route.ts — same reasoning as the support-tickets equivalent constant.
export const controlAlertInclude = {
  membre:      { select: { firstName: true, lastName: true, email: true, createdAt: true } },
  association: { select: { name: true, slug: true } },
} as const

export type ControlAlertOrigin = { source: string | null; actorName: string | null }

function metadataRecord(metadata: Prisma.JsonValue | null): Record<string, unknown> | null {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : null
}

// How the member was created (manual add, which public form, a webhook, a bulk import…) is
// recorded on the MEMBRE_CREATED ActivityLog entry (entityId = membre.id) at every creation
// site — see src/lib/membres/create-membre.ts and friends — but was never surfaced here, so
// a superadmin investigating an alert had to go query the database by hand every time (the
// exact manual lookup this is meant to replace). One batch query for the whole page instead
// of N+1 per alert.
//
// A member approved from a pending public request (PATCH /api/membres/[id], isApproval) never
// gets a MEMBRE_CREATED entry at all — only a MEMBRE_INSCRIPTION_REQUESTED at signup (anonymous,
// no actor) and a MEMBRE_UPDATED at approval time (tagged approvedFromPending, see that route).
// That approval is exactly the moment a paid pendingTier goes ACTIF with no Cotisation — the
// shape most of these alerts actually have — so it's resolved here too, falling back from the
// request's own source to whoever approved it.
async function resolveOrigins(membreIds: string[]): Promise<Map<string, ControlAlertOrigin>> {
  if (membreIds.length === 0) return new Map()

  const [creationLogs, approvalLogs] = await Promise.all([
    prisma.activityLog.findMany({
      where:  { entity: "Membre", action: { in: ["MEMBRE_CREATED", "MEMBRE_INSCRIPTION_REQUESTED"] }, entityId: { in: membreIds } },
      select: { entityId: true, actorId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.activityLog.findMany({
      where:  { entity: "Membre", action: "MEMBRE_UPDATED", entityId: { in: membreIds }, metadata: { path: ["approvedFromPending"], equals: true } },
      select: { entityId: true, actorId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const actorIds = [...new Set([...creationLogs, ...approvalLogs].map(l => l.actorId).filter((id): id is string => !!id))]
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : []
  const actorNameById = new Map(actors.map(a => [a.id, a.name || a.email]))

  const origins = new Map<string, ControlAlertOrigin>()
  for (const log of creationLogs) {
    if (!log.entityId || origins.has(log.entityId)) continue
    const source = metadataRecord(log.metadata)?.source
    origins.set(log.entityId, {
      source: typeof source === "string" ? source : null,
      actorName: log.actorId ? actorNameById.get(log.actorId) ?? null : null,
    })
  }
  // Only fills the actor in — the request's own source label (or "unknown" if even that is
  // missing) stays, since "who approved" doesn't change "where they originally signed up".
  for (const log of approvalLogs) {
    if (!log.entityId || !log.actorId) continue
    const existing = origins.get(log.entityId) ?? { source: null, actorName: null }
    if (!existing.actorName) origins.set(log.entityId, { ...existing, actorName: actorNameById.get(log.actorId) ?? null })
  }
  return origins
}

// Defaults to OUVERT — an actionable inbox, like the support-tickets list — rather than
// showing every alert ever resolved by default. Paginated + searchable: a bulk import can
// raise dozens or hundreds of alerts in one sweep run, and an unbounded findMany here would
// mean fetching (and rendering) all of them at once with no way to narrow down to one
// association or member.
export const GET = withSuperAdminAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const search = searchParams.get("search")?.trim()
  const { page, limit, skip } = parsePagination(searchParams)

  const where: Prisma.MembreControlAlertWhereInput = {
    ...(status === "OUVERT" || status === "RESOLU" ? { status } : {}),
    ...(search ? {
      OR: [
        { membre:      { firstName: { contains: search, mode: "insensitive" } } },
        { membre:      { lastName:  { contains: search, mode: "insensitive" } } },
        { membre:      { email:     { contains: search, mode: "insensitive" } } },
        { association: { name:      { contains: search, mode: "insensitive" } } },
      ],
    } : {}),
  }

  const [alerts, total] = await Promise.all([
    prisma.membreControlAlert.findMany({ where, include: controlAlertInclude, orderBy: { raisedAt: "desc" }, skip, take: limit }),
    prisma.membreControlAlert.count({ where }),
  ])

  const origins = await resolveOrigins(alerts.map(a => a.membreId))
  const data = alerts.map(alert => ({ ...alert, origin: origins.get(alert.membreId) ?? { source: null, actorName: null } }))

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) } satisfies PaginatedResult<typeof data[number]>)
})

const bulkResolveSchema = z.object({ ids: z.array(z.string()).min(1).max(200), note: z.string().optional() })

// Bulk resolve for the DataTable's row-selection checkboxes — a single sweep after a bulk
// import can raise far too many alerts to click "Résoudre" on one at a time. Applies the same
// (optional) note to every selected alert; silently no-ops on any id that's already RESOLU or
// doesn't exist, same as the single-alert PATCH would via its 404, but batched here isn't
// worth failing the whole request over one stale id.
export const PATCH = withSuperAdminAuth(async (req, { userId }) => {
  const parsed = bulkResolveSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { count } = await prisma.membreControlAlert.updateMany({
    where: { id: { in: parsed.data.ids }, status: "OUVERT" },
    data: {
      status:       "RESOLU",
      resolvedAt:   new Date(),
      resolvedById: userId,
      autoResolved: false,
      note:         parsed.data.note,
    },
  })
  return NextResponse.json({ resolved: count })
})

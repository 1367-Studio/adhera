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

  const [data, total] = await Promise.all([
    prisma.membreControlAlert.findMany({ where, include: controlAlertInclude, orderBy: { raisedAt: "desc" }, skip, take: limit }),
    prisma.membreControlAlert.count({ where }),
  ])

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

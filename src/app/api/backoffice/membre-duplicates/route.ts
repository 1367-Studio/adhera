import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { parsePagination, type PaginatedResult } from "@/lib/pagination"
import type { MembreDuplicateMatchListItem, MembreDuplicateSummary } from "@/lib/schemas"

// Shared with ./[id]/route.ts, same reasoning as controlAlertInclude.
export const duplicateMatchInclude = {
  membreA:     { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
  membreB:     { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
  association: { select: { name: true, slug: true } },
} as const

function toSummary(membre: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; status: string }): MembreDuplicateSummary {
  return membre
}

// Cross-association monitoring list — same shape as the association-scoped list, plus an
// association column, same convention as /api/backoffice/control-alerts.
export const GET = withSuperAdminAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const search = searchParams.get("search")?.trim()
  const { page, limit, skip } = parsePagination(searchParams)

  const where: Prisma.MembreDuplicateMatchWhereInput = {
    ...(status === "PENDING" || status === "DISMISSED" || status === "MERGED" ? { status } : {}),
    ...(search ? {
      OR: [
        { membreA:     { firstName: { contains: search, mode: "insensitive" } } },
        { membreA:     { lastName:  { contains: search, mode: "insensitive" } } },
        { membreA:     { email:     { contains: search, mode: "insensitive" } } },
        { membreB:     { firstName: { contains: search, mode: "insensitive" } } },
        { membreB:     { lastName:  { contains: search, mode: "insensitive" } } },
        { membreB:     { email:     { contains: search, mode: "insensitive" } } },
        { association: { name:      { contains: search, mode: "insensitive" } } },
      ],
    } : {}),
  }

  const [matches, total] = await Promise.all([
    prisma.membreDuplicateMatch.findMany({
      where, include: duplicateMatchInclude, orderBy: { lastSeenAt: "desc" }, skip, take: limit,
    }),
    prisma.membreDuplicateMatch.count({ where }),
  ])

  const data = matches.map(match => ({
    id:              match.id,
    associationId:   match.associationId,
    associationName: match.association.name,
    membreA:         toSummary(match.membreA),
    membreB:         toSummary(match.membreB),
    matchedFields:   match.matchedFields,
    status:          match.status,
    firstDetectedAt: match.firstDetectedAt.toISOString(),
    lastSeenAt:      match.lastSeenAt.toISOString(),
    autoDismissed:   match.autoDismissed,
  } satisfies MembreDuplicateMatchListItem & { associationName: string }))

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) } satisfies PaginatedResult<typeof data[number]>)
})

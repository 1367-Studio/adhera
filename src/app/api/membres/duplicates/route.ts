import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { parsePagination, type PaginatedResult } from "@/lib/pagination"
import type { MembreDuplicateMatchListItem, MembreDuplicateSummary } from "@/lib/schemas"

const membreSummarySelect = { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } as const

function toSummary(membre: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; status: string }): MembreDuplicateSummary {
  return membre
}

// Defaults to PENDING — an actionable inbox, same convention as the backoffice control-
// alerts list (defaults to OUVERT rather than showing every historical row).
export const GET = withAdminAuth(async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const search = searchParams.get("search")?.trim()
  const { page, limit, skip } = parsePagination(searchParams)

  const where: Prisma.MembreDuplicateMatchWhereInput = {
    associationId: ctx.associationId,
    ...(status === "PENDING" || status === "DISMISSED" || status === "MERGED" ? { status } : {}),
    ...(search ? {
      OR: [
        { membreA: { firstName: { contains: search, mode: "insensitive" } } },
        { membreA: { lastName:  { contains: search, mode: "insensitive" } } },
        { membreA: { email:     { contains: search, mode: "insensitive" } } },
        { membreB: { firstName: { contains: search, mode: "insensitive" } } },
        { membreB: { lastName:  { contains: search, mode: "insensitive" } } },
        { membreB: { email:     { contains: search, mode: "insensitive" } } },
      ],
    } : {}),
  }

  const [matches, total] = await Promise.all([
    prisma.membreDuplicateMatch.findMany({
      where,
      include: { membreA: { select: membreSummarySelect }, membreB: { select: membreSummarySelect } },
      orderBy: { lastSeenAt: "desc" },
      skip, take: limit,
    }),
    prisma.membreDuplicateMatch.count({ where }),
  ])

  const data: MembreDuplicateMatchListItem[] = matches.map(match => ({
    id:              match.id,
    associationId:   match.associationId,
    membreA:         toSummary(match.membreA),
    membreB:         toSummary(match.membreB),
    matchedFields:   match.matchedFields,
    status:          match.status,
    firstDetectedAt: match.firstDetectedAt.toISOString(),
    lastSeenAt:      match.lastSeenAt.toISOString(),
    autoDismissed:   match.autoDismissed,
  }))

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) } satisfies PaginatedResult<MembreDuplicateMatchListItem>)
}, { area: "membres" })

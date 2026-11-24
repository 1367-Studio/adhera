import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { withAdminAuth } from "@/lib/api-wrapper"

// FORM-114 — association-wide list of federative licenses, filterable by fédération/saison/
// statut and searchable by membre name, for authorized staff to track and export.
export function buildLicenseWhere(associationId: string, searchParams: URLSearchParams): Prisma.MembershipLicenseWhereInput {
  const federation = searchParams.get("federation") || undefined
  const season      = searchParams.get("season") || undefined
  const status      = searchParams.get("status") || undefined
  const search      = searchParams.get("search") || undefined

  return {
    associationId,
    // mode: "insensitive" — federation/season are free text per tier (see MembershipTier.
    // licenseFederation/licenseSeason), so two tiers typed as "FFF" and "fff" must still
    // filter together rather than reading as two unrelated values.
    ...(federation ? { federation: { equals: federation, mode: "insensitive" } } : {}),
    ...(season ? { season: { equals: season, mode: "insensitive" } } : {}),
    ...(status ? { status: status as "A_SOLICITAR" | "EM_ANDAMENTO" | "VALIDADA" | "A_RENOVAR" } : {}),
    ...(search ? {
      membre: {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName:  { contains: search, mode: "insensitive" } },
        ],
      },
    } : {}),
  }
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)
  const where = buildLicenseWhere(associationId, searchParams)

  const include = {
    membre:     { select: { id: true, firstName: true, lastName: true } },
    cotisation: { select: { year: true, tier: { select: { label: true } } } },
  }
  const orderBy = [{ season: "desc" as const }, { membre: { lastName: "asc" as const } }]

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.membershipLicense.findMany({ where, include, orderBy, skip, take: limit }),
    prisma.membershipLicense.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { area: "adhesions", module: "cotisations" })

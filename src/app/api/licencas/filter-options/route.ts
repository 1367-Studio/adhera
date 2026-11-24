import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Case-insensitive dedupe, keeping whichever casing was seen first (DB order) — "FFF" and
// "fff" typed on two different tiers must collapse into one filter option, not two (see
// buildLicenseWhere's own mode: "insensitive" matching in ../route.ts).
function dedupeInsensitive(values: string[]): string[] {
  const seen = new Map<string, string>()
  for (const v of values) {
    const key = v.toLowerCase()
    if (!seen.has(key)) seen.set(key, v)
  }
  return [...seen.values()]
}

// FORM-114 — distinct fédération/saison values already in use, for the Licenças list's filter
// selects (status is a fixed enum, no lookup needed for it). Each list is narrowed by the
// OTHER currently-active filters (status, and the other of federation/season) — e.g. once a
// status is picked, the federation/season dropdowns only offer values that actually occur
// under that status, instead of every value the association has ever had.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)
  const season      = searchParams.get("season") || undefined
  const federation  = searchParams.get("federation") || undefined
  const status      = (searchParams.get("status") || undefined) as "A_SOLICITAR" | "EM_ANDAMENTO" | "VALIDADA" | "A_RENOVAR" | undefined

  const [federationRows, seasonRows] = await Promise.all([
    prisma.membershipLicense.findMany({
      where:  { associationId, status, ...(season ? { season: { equals: season, mode: "insensitive" } } : {}) },
      select: { federation: true },
      orderBy: { federation: "asc" },
    }),
    prisma.membershipLicense.findMany({
      where:  { associationId, status, ...(federation ? { federation: { equals: federation, mode: "insensitive" } } : {}) },
      select: { season: true },
      orderBy: { season: "desc" },
    }),
  ])

  return NextResponse.json({
    federations: dedupeInsensitive(federationRows.map(f => f.federation)),
    seasons:     dedupeInsensitive(seasonRows.map(s => s.season)),
  })
}, { area: "adhesions", module: "cotisations" })

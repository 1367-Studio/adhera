import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Feeds the "Filtres" popover's "Pays" dropdown on the Membres page — distinct, non-empty
// `country` values actually stored on this association's members, same pattern as
// /api/cotisations/tier-options. `country` is free text (see AddressFields' COUNTRY_SUGGESTIONS,
// a <datalist> of suggestions, never enforced), so the same country routinely shows up spelled
// several ways ("France" vs "france"). The filter route matches case-insensitively (see GET
// /api/membres), so picking "France" here also returns the "france" rows — this list must
// collapse those the same way, one entry per country regardless of casing, or an admin would
// see two near-identical options that secretly do the same thing.
export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const rows = await prisma.membre.findMany({
    where:    { associationId, deletedAt: null, country: { not: null } },
    distinct: ["country"],
    select:   { country: true },
  })

  const raw = rows
    .map(r => r.country?.trim())
    .filter((c): c is string => !!c)

  // Case-insensitive dedup. `localeCompare` does NOT reliably sort "France" before "france"
  // (collation order between cases is locale-dependent, occasionally lowercase-first) — relying
  // on sort order to pick the display label picked the wrong one in testing. Instead, prefer
  // whichever spelling actually looks like a capitalized country name ("France"), falling back
  // to the first one encountered only if none in the group does.
  const looksCapitalized = (s: string) => /^[A-ZÀ-ÖØ-Þ]/.test(s)
  const byKey = new Map<string, string>()
  for (const c of raw) {
    const key = c.toLowerCase()
    const existing = byKey.get(key)
    if (!existing || (looksCapitalized(c) && !looksCapitalized(existing))) byKey.set(key, c)
  }

  const countries = [...byKey.values()].sort((a, b) => a.localeCompare(b))

  return NextResponse.json({ countries })
}, { area: "membres" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

// Feeds the "Catégorie d'adhésion" filter on the Cotisations page — distinct tiers that have at
// least one Cotisation, for a member still around (deletedAt: null) — same scope as the list/
// indicators/distribution (see cotisation-query.ts), so a category never appears in the filter
// only to show an empty table the moment it's selected. Unlike /api/membership-forms/tier-
// options (ONE_OFF, published, paid tiers only — a different, narrower use case: the add-member
// modal's payment-link picker), a cotisation can legitimately reference a RECURRING, free, or
// since-archived tier, and the filter must still be able to find it.
export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const [rows, uncategorized] = await Promise.all([
    prisma.cotisation.findMany({
      where:    { associationId, tierId: { not: null }, membre: { deletedAt: null } },
      distinct: ["tierId"],
      select:   { tierId: true, tier: { select: { label: true } } },
    }),
    // Whether the "Sans catégorie" option (NO_CATEGORY_FILTER, see cotisation-filters.ts) has
    // anything to actually filter to — some cotisations are never linked to a tier (manual
    // admin-created rows, or ones whose tier was since deleted, which SetNull's tierId).
    prisma.cotisation.count({ where: { associationId, tierId: null, membre: { deletedAt: null } } }),
  ])

  const tiers = rows
    .filter((r): r is typeof r & { tierId: string; tier: { label: string } } => !!r.tierId && !!r.tier)
    .map(r => ({ id: r.tierId, label: r.tier.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return NextResponse.json({ tiers, hasUncategorized: uncategorized > 0 })
}, { area: "adhesions" })

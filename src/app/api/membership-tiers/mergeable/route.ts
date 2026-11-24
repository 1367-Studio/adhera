import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { listAllMergeableMembershipTiers } from "@/lib/membership-tier-duplicates"

// Feeds the "Fusionner manuellement deux catégories" fallback in MergeDuplicateTiersModal —
// every active tier, for when the automatic label-matching in /api/membership-tiers/duplicates
// doesn't catch two categories the admin knows are duplicates.
export const GET = withAdminAuth(async (_req, ctx) => {
  const tiers = await listAllMergeableMembershipTiers(ctx.associationId)
  return NextResponse.json({ tiers })
}, { area: "adhesions", access: "edit", module: "cotisations" })

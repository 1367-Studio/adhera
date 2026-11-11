import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { findDuplicateMembershipTierGroups } from "@/lib/membership-tier-duplicates"

// Feeds the "Fusionner les catégories en double" entry in the Cotisations page's "Catégorie"
// filter — suggestions only, see findDuplicateMembershipTierGroups.
export const GET = withAdminAuth(async (_req, ctx) => {
  const groups = await findDuplicateMembershipTierGroups(ctx.associationId)
  return NextResponse.json({ groups })
}, { area: "adhesions", access: "edit", module: "cotisations" })

import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { parseCotisationFilters, computeCotisationDistribution } from "@/lib/cotisation-query"

// Backs "Voir la répartition" — one row per (catégorie d'adhésion × modalité de renouvellement)
// combination, computed over every cotisation matching the page's active filters (not just the
// current page of results), plus a total row. Renewal mode is Cotisation.subscriptionId's
// presence, never the payment method (a card payment can still belong to a manually-renewed
// adhésion) — see cotisation-query.ts.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)
  const filters = parseCotisationFilters(searchParams)
  const result  = await computeCotisationDistribution(associationId, filters)
  return NextResponse.json(result)
}, { area: "adhesions" })

import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { computeFinanceDashboardTotals } from "@/lib/finance/dashboard-stats"

// ?dateFrom=&dateTo= — both optional, omitted means all-time. Backs the Painel's stat tiles;
// see computeFinanceDashboardTotals's own doc comment for why this excludes IN_KIND/
// IMMOBILISATION instead of summing every Income/Expense row like the generic list endpoints.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get("dateFrom") ?? undefined
  const dateTo   = searchParams.get("dateTo")   ?? undefined

  const totals = await computeFinanceDashboardTotals(associationId, dateFrom, dateTo)
  return NextResponse.json(totals)
}, { area: "comptabilite", module: "finances" })

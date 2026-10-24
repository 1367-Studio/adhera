import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { ensureDefaultFinanceCategories } from "@/lib/finance/default-categories"

export const POST = withAdminAuth(async (req, ctx) => {
  const created = await ensureDefaultFinanceCategories(ctx.associationId)
  return NextResponse.json({ created })
}, { area: "comptabilite", module: "finances" })

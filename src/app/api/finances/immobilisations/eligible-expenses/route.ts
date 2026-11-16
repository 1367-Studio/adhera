// src/app/api/finances/immobilisations/eligible-expenses/route.ts
// Expense rows a treasurer can turn into an Immobilisation: flagged isImmobilisation, not
// already linked to one, categorized to one of the asset accounts the Immobilisation model
// supports (218300 corporelles, 205000 incorporelles — kept in sync with ASSET_CLASSES in
// ../route.ts, which actually resolves the class at creation time).
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ELIGIBLE_ASSET_ACCOUNT_CODES = ["218300", "205000"]

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const expenses = await prisma.expense.findMany({
    where: {
      associationId,
      isImmobilisation: true,
      immobilisation:   null,
      category: { accountingCode: { in: ELIGIBLE_ASSET_ACCOUNT_CODES } },
    },
    select: { id: true, description: true, vendor: true, amount: true, date: true },
    orderBy: { date: "desc" },
  })
  return NextResponse.json(expenses)
}, { area: "comptabilite", module: "finances" })

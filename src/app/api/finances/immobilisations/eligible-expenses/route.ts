// src/app/api/finances/immobilisations/eligible-expenses/route.ts
// Expense rows a treasurer can turn into an Immobilisation: flagged isImmobilisation, not
// already linked to one, categorized to the one asset account Fase 2 supports (218300) — see
// immobilisationSchema's doc comment.
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const expenses = await prisma.expense.findMany({
    where: {
      associationId,
      isImmobilisation: true,
      immobilisation:   null,
      category: { accountingCode: "218300" },
    },
    select: { id: true, description: true, vendor: true, amount: true, date: true },
    orderBy: { date: "desc" },
  })
  return NextResponse.json(expenses)
}, { area: "comptabilite", module: "finances" })

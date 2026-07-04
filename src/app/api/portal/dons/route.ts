import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const dons = await prisma.don.findMany({
    where:   { associationId: ctx.associationId, membreId: ctx.membreId! },
    orderBy: { createdAt: "desc" },
    select: {
      id:              true,
      amount:          true,
      message:         true,
      anonymous:       true,
      paidAt:          true,
      createdAt:       true,
      receiptNumber:   true,
      receiptIssuedAt: true,
      association:     { select: { canIssueTaxReceipts: true } },
    },
  })

  return NextResponse.json(dons)
})

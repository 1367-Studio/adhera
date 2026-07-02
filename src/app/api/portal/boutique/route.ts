import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const produits = await prisma.boutiqueProduit.findMany({
    where:   { associationId: ctx.associationId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true },
      },
    },
  })

  return NextResponse.json(produits)
}, { module: "boutique", requireMembre: false })

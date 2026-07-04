import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

export const GET = withPortalAuth<Params>(async (_req, ctx, { id }) => {
  const produit = await prisma.boutiqueProduit.findFirst({
    where:   { id, associationId: ctx.associationId, status: "ACTIVE" },
    include: {
      variantes: {
        orderBy: { createdAt: "asc" },
        select:  { id: true, label: true, price: true, stock: true },
      },
    },
  })
  if (!produit) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 })

  return NextResponse.json(produit)
}, { module: "boutique", requireMembre: false })

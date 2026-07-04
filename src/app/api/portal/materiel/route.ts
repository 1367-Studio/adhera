import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [materials, myLoans] = await Promise.all([
    // Fix 7: exclude PERDU/HORS_SERVICE from member catalog
    prisma.material.findMany({
      where:   { associationId: ctx.associationId, status: { notIn: ["PERDU", "HORS_SERVICE"] } },
      orderBy: { name: "asc" },
      include: {
        loans: {
          where:  { returnedAt: null, status: "CONFIRME" },
          select: { quantity: true },
        },
      },
    }),
    // Fix 1: include REFUSE loans (last 30 days) so member knows they were denied
    prisma.materialLoan.findMany({
      where: {
        membreId: ctx.membreId!,
        material: { associationId: ctx.associationId },
        OR: [
          { returnedAt: null, status: { in: ["DEMANDE", "CONFIRME"] } },
          { status: "REFUSE", createdAt: { gte: thirtyDaysAgo } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        material: { select: { id: true, name: true, category: true } },
      },
    }),
  ])

  const catalog = materials.map(m => {
    const loanedQty = m.loans.reduce((s, l) => s + l.quantity, 0)
    return {
      id:           m.id,
      name:         m.name,
      category:     m.category,
      description:  m.description,
      location:     m.location,
      quantity:     m.quantity,
      status:       m.status,
      availableQty: Math.max(0, m.quantity - loanedQty), // Fix 10: clamp to 0
    }
  })

  return NextResponse.json({ catalog, myLoans })
})

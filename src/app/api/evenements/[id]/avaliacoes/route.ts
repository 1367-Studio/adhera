import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const [avis, aggregate] = await Promise.all([
    prisma.evenementAvis.findMany({
      where:   { evenementId },
      orderBy: { createdAt: "desc" },
      include: { participation: { select: { firstName: true, lastName: true } } },
    }),
    prisma.evenementAvis.aggregate({
      where: { evenementId },
      _avg:   { rating: true },
      _count: { _all: true },
    }),
  ])

  return NextResponse.json({
    average: aggregate._avg.rating,
    count:   aggregate._count._all,
    avis: avis.map(a => ({
      id:        a.id,
      firstName: a.participation.firstName,
      lastName:  a.participation.lastName,
      rating:    a.rating,
      comment:   a.comment,
      createdAt: a.createdAt,
    })),
  })
})

import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, userId } = ctx

  const { id } = await params

  const actualite = await prisma.actualite.findFirst({
    where: { id, associationId, publishedAt: { not: null } },
    include: {
      evenement: {
        select: { id: true, title: true, date: true, endDate: true, location: true, lat: true, lng: true, price: true, description: true },
      },
    },
  })

  if (!actualite) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  let evenementRsvp: string | null = null
  if (actualite.evenementId) {
    const membre = await prisma.membre.findFirst({
      where:  { userId, associationId, deletedAt: null },
      select: { id: true },
    })
    if (membre) {
      const participation = await prisma.participation.findUnique({
        where:  { membreId_evenementId: { membreId: membre.id, evenementId: actualite.evenementId } },
        select: { rsvp: true },
      })
      evenementRsvp = participation?.rsvp ?? null
    }
  }

  return NextResponse.json({ ...actualite, evenementRsvp })
}

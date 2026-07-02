import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, membreId } = ctx

  const actualite = await prisma.actualite.findFirst({
    where: { id, associationId, publishedAt: { not: null } },
    include: {
      evenement: {
        select: { id: true, title: true, date: true, endDate: true, location: true, lat: true, lng: true, price: true, description: true },
      },
    },
  })

  if (!actualite) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  if (actualite.recipientMode === "SELECTED") {
    const recipient = membreId
      ? await prisma.actualiteRecipient.findUnique({
          where: { actualiteId_membreId: { actualiteId: id, membreId } },
        })
      : null
    if (!recipient) return NextResponse.json({ error: "Non autorisé" }, { status: 403 })
  }

  let evenementRsvp: string | null = null
  if (actualite.evenementId && membreId) {
    const participation = await prisma.participation.findUnique({
      where:  { membreId_evenementId: { membreId, evenementId: actualite.evenementId } },
      select: { rsvp: true },
    })
    evenementRsvp = participation?.rsvp ?? null
  }

  return NextResponse.json({ ...actualite, evenementRsvp })
}, { requireMembre: false })

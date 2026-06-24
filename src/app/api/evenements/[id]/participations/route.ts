import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { id: evenementId } = await params

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where:   { associationId, deletedAt: null, status: "ACTIF" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      participations: {
        where:  { evenementId },
        select: { id: true, present: true, rsvp: true },
      },
    },
  })

  const data = membres.map(m => ({
    membreId:        m.id,
    firstName:       m.firstName,
    lastName:        m.lastName,
    participationId: m.participations[0]?.id  ?? null,
    present:         m.participations[0]?.present ?? false,
    rsvp:            m.participations[0]?.rsvp    ?? null,
  }))

  return NextResponse.json(data)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { id: evenementId } = await params

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const { membreId, present } = await req.json() as { membreId: string; present: boolean }

  const membre = await prisma.membre.findFirst({ where: { id: membreId, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  if (present && evenement.capacity != null) {
    const presentCount = await prisma.participation.count({
      where: { evenementId, present: true, membreId: { not: membreId } },
    })
    if (presentCount >= evenement.capacity) {
      return NextResponse.json({ error: "Capacité maximale atteinte" }, { status: 422 })
    }
  }

  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId, evenementId } },
    create: { membreId, evenementId, present },
    update: { present },
  })

  return NextResponse.json(participation)
}

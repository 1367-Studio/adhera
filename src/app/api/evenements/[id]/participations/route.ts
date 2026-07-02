import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

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
        select: { id: true, present: true, rsvp: true, ticketPaidAt: true, quantity: true, paidQuantity: true },
      },
    },
  })

  const data = membres.map(m => ({
    membreId:        m.id,
    firstName:       m.firstName,
    lastName:        m.lastName,
    participationId: m.participations[0]?.id            ?? null,
    present:         m.participations[0]?.present        ?? false,
    rsvp:            m.participations[0]?.rsvp           ?? null,
    ticketPaidAt:    m.participations[0]?.ticketPaidAt   ?? null,
    quantity:        m.participations[0]?.quantity       ?? 1,
    paidQuantity:    m.participations[0]?.paidQuantity   ?? null,
  }))

  return NextResponse.json(data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { id: evenementId } = await params
  const { membreId, paidQuantity: rawPaid } = await req.json() as { membreId: string; paidQuantity?: number }

  const evenement = await prisma.evenement.findFirst({
    where: { id: evenementId, associationId },
    select: { title: true, price: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (!evenement.price || Number(evenement.price) === 0)
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })

  const membre = await prisma.membre.findFirst({ where: { id: membreId, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existing = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId, evenementId } },
    select: { id: true, ticketPaidAt: true, quantity: true },
  })
  if (existing?.ticketPaidAt)
    return NextResponse.json({ error: "Déjà marqué comme payé" }, { status: 409 })

  const paidAt      = new Date()
  const reservedQty = existing?.quantity ?? null
  const paidQty     = rawPaid != null
    ? reservedQty != null
      ? Math.min(Math.max(1, Math.round(rawPaid)), reservedQty)
      : Math.max(1, Math.round(rawPaid))
    : (reservedQty ?? 1)
  const total       = Number(evenement.price) * paidQty

  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId, evenementId } },
    create: { membreId, evenementId, ticketPaidAt: paidAt, paidQuantity: paidQty, quantity: paidQty },
    update: { ticketPaidAt: paidAt, paidQuantity: paidQty },
  })

  await prisma.income.create({
    data: {
      associationId,
      memberId:    membreId,
      amount:      total,
      description: paidQty > 1
        ? `${paidQty} billets (espèces) — ${evenement.title} — ${membre.firstName} ${membre.lastName}`
        : `Billet (espèces) — ${evenement.title} — ${membre.firstName} ${membre.lastName}`,
      source:      "MANUAL",
      status:      "PAID",
      date:        paidAt,
    },
  })

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "TICKET_PAID",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { memberName: `${membre.firstName} ${membre.lastName}`, quantity: paidQty },
  })

  return NextResponse.json(participation)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { id: evenementId } = await params

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const { membreId, present } = await req.json() as { membreId: string; present: boolean }

  const membre = await prisma.membre.findFirst({ where: { id: membreId, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  if (present && evenement.capacity != null) {
    const [presentParticipations, memberParticipation] = await Promise.all([
      prisma.participation.findMany({
        where:  { evenementId, present: true, membreId: { not: membreId } },
        select: { quantity: true, paidQuantity: true },
      }),
      prisma.participation.findUnique({
        where:  { membreId_evenementId: { membreId, evenementId } },
        select: { quantity: true, paidQuantity: true },
      }),
    ])
    const occupiedSlots =
      presentParticipations.reduce((sum, p) => sum + (p.paidQuantity ?? p.quantity), 0) +
      (memberParticipation?.paidQuantity ?? memberParticipation?.quantity ?? 1)
    if (occupiedSlots > evenement.capacity) {
      return NextResponse.json({ error: "Capacité maximale atteinte" }, { status: 422 })
    }
  }

  const existingParticipation = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId, evenementId } },
    select: { present: true },
  })

  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId, evenementId } },
    create: { membreId, evenementId, present },
    update: { present },
  })

  if (existingParticipation?.present !== present) {
    await writeActivityLog({
      associationId,
      actorId:  userId,
      action:   "PRESENCE_MARKED",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { present, memberName: `${membre.firstName} ${membre.lastName}` },
    })
  }

  return NextResponse.json(participation)
}

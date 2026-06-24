import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { evenementUpdateSchema } from "@/lib/schemas"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { id } = await params
  const evenement = await prisma.evenement.findFirst({
    where: { id, associationId },
    include: {
      participations: {
        include: { membre: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { membre: { lastName: "asc" } },
      },
      _count: { select: { participations: { where: { present: true } } } },
    },
  })

  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  return NextResponse.json(evenement)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = evenementUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, endDate, description, location, lat, lng, price, capacity, ...rest } = parsed.data
  const evenement = await prisma.evenement.update({
    where: { id },
    data: {
      ...rest,
      ...(date        ? { date:        new Date(date)    } : {}),
      ...(endDate     !== undefined ? { endDate:     endDate     ? new Date(endDate)  : null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(location    !== undefined ? { location:    location    || null } : {}),
      ...(lat         !== undefined ? { lat }                              : {}),
      ...(lng         !== undefined ? { lng }                              : {}),
      ...(price       !== undefined ? { price:    price    ?? null }       : {}),
      ...(capacity    !== undefined ? { capacity: capacity ?? null }       : {}),
    },
  })

  return NextResponse.json(evenement)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  await prisma.evenement.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}

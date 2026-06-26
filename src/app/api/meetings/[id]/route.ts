import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { id } = await params
  const meeting = await prisma.meeting.findFirst({
    where: { id, associationId },
    include: {
      participants: {
        include: { membre: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  })

  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  return NextResponse.json(meeting)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const body = await req.json()
  const { status, endedAt, summary, transcript } = body

  const meeting = await prisma.meeting.update({
    where: { id },
    data: {
      ...(status    !== undefined ? { status }                     : {}),
      ...(endedAt   !== undefined ? { endedAt: new Date(endedAt) } : {}),
      ...(summary   !== undefined ? { summary }                    : {}),
      ...(transcript !== undefined ? { transcript }                : {}),
    },
  })

  return NextResponse.json(meeting)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  await prisma.meeting.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}

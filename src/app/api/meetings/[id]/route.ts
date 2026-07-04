import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

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
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

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

  await writeActivityLog({
    associationId,
    actorId: ctx.userId,
    action:  "MEETING_UPDATED",
    entity:  "Meeting",
    entityId: id,
    label:   existing.title,
  })

  return NextResponse.json(meeting)
}, { roles: MANAGERS })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const existing = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  await prisma.meeting.delete({ where: { id } })

  await writeActivityLog({
    associationId,
    actorId: ctx.userId,
    action:  "MEETING_DELETED",
    entity:  "Meeting",
    entityId: id,
    label:   existing.title,
  })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS })

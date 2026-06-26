import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { meetingInviteEmail } from "@/lib/email"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const meetings = await prisma.meeting.findMany({
    where: { associationId },
    include: {
      participants: {
        include: { membre: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(meetings)
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { title, description, scheduledAt, participantIds, instant } = body

  if (!title) return NextResponse.json({ error: "Titre requis" }, { status: 422 })

  const roomName = `adhera-${associationId.slice(-8)}-${Date.now()}`

  const meeting = await prisma.meeting.create({
    data: {
      associationId,
      title,
      description: description || null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      status: instant ? "LIVE" : "SCHEDULED",
      startedAt: instant ? new Date() : null,
      roomName,
      createdById: userId,
      participants: {
        create: (participantIds ?? []).map((membreId: string) => ({ membreId })),
      },
    },
    include: {
      participants: {
        include: { membre: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  })

  // Send email invites to participants that have a user account
  if ((participantIds ?? []).length > 0) {
    const association = await prisma.association.findUnique({
      where: { id: associationId },
      select: { name: true, slug: true },
    })
    const membres = await prisma.membre.findMany({
      where: { id: { in: participantIds }, userId: { not: null } },
      include: { user: { select: { name: true, email: true } } },
    })
    const portalBase = `${process.env.NEXTAUTH_URL ?? ""}/portal/${association?.slug}/reunions`
    for (const m of membres) {
      if (!m.user?.email) continue
      void sendEmail(meetingInviteEmail({
        firstName:       m.firstName,
        email:           m.user.email,
        associationName: association?.name ?? "",
        meetingTitle:    title,
        scheduledAt:     scheduledAt ? new Date(scheduledAt) : null,
        instant:         !!instant,
        portalUrl:       portalBase,
      }))
    }
  }

  return NextResponse.json(meeting, { status: 201 })
}

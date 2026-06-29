import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmail } from "@/lib/mail"
import { meetingInviteEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

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

  const guard = await guardModule(associationId, "reunions")
  if (guard) return guard

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

  // Send email invites and in-app notifications to participants that have a user account
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

    const notifTitle = instant
      ? `Réunion en cours : ${title}`
      : `Nouvelle réunion : ${title}`
    const notifBody = instant
      ? "Une réunion vient de démarrer. Rejoignez-la maintenant."
      : "Vous avez été invité à une réunion."

    await prisma.notification.createMany({
      data: membres
        .filter(m => m.userId)
        .map(m => ({
          userId: m.userId!,
          title:  notifTitle,
          body:   notifBody,
          link:   portalBase,
        })),
      skipDuplicates: true,
    })

    await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
  }

  await writeActivityLog({
    associationId,
    actorId: userId,
    action:  "MEETING_CREATED",
    entity:  "Meeting",
    entityId: meeting.id,
    label:   meeting.title,
  })

  return NextResponse.json(meeting, { status: 201 })
}

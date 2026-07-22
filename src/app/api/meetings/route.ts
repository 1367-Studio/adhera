import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmail } from "@/lib/mail"
import { meetingInviteEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { meetingCreateSchema } from "@/lib/schemas"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
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
})

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = meetingCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { title, description, type, scheduledAt, participantIds, instant } = parsed.data

  if ((participantIds ?? []).length > 0) {
    // Same reasoning as the PATCH route: a membreId that exists but belongs to a different
    // association would otherwise pass straight through and get attached as a participant.
    const validCount = await prisma.membre.count({ where: { id: { in: participantIds }, associationId } })
    if (validCount !== participantIds!.length) {
      return NextResponse.json({ error: "Un ou plusieurs membres sont introuvables." }, { status: 422 })
    }
  }

  const roomName = `adhera-${associationId.slice(-8)}-${Date.now()}`

  const meeting = await prisma.meeting.create({
    data: {
      associationId,
      title,
      description: description || null,
      type: type || "GENERALE",
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
      select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
    })
    const membres = await prisma.membre.findMany({
      where: { id: { in: participantIds }, userId: { not: null } },
      include: { user: { select: { name: true, email: true } } },
    })
    const portalBase = `${process.env.NEXTAUTH_URL ?? ""}/portal/${association?.slug}/reunions`
    const branding = association ? resolveDocumentBranding(association) : null
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
        branding,
      }), { associationId, membreId: m.id, source: "MEETING_INVITE", sourceId: meeting.id })
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

  // Lets any dashboard/portal tab already open on this association pick up the new
  // meeting immediately instead of waiting on the next window refocus/remount.
  await pusherServer
    .trigger(`private-association-${associationId}`, "meeting-created", {
      meetingId:   meeting.id,
      title:       meeting.title,
      status:      meeting.status,
      createdById: meeting.createdById,
    })
    .catch(() => {})

  await writeActivityLog({
    associationId,
    actorId: userId,
    action:  "MEETING_CREATED",
    entity:  "Meeting",
    entityId: meeting.id,
    label:   meeting.title,
  })

  return NextResponse.json(meeting, { status: 201 })
}, { roles: MANAGERS, module: "reunions" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { meetingUpdateSchema } from "@/lib/schemas"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmail } from "@/lib/mail"
import { meetingInviteEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { MEETING_WITH_PARTICIPANTS_SELECT } from "@/lib/meetings/select"

// Editing what a meeting *is* (title/description/scheduledAt/type/participants) only makes
// sense before it happens — once it's LIVE or ENDED, rewriting those fields would silently
// contradict what participants already saw/attended. status/endedAt/summary/transcript are
// exempt since those are how a meeting normally progresses through its own lifecycle.
const STRUCTURAL_FIELDS = ["title", "description", "type", "scheduledAt", "participantIds"] as const

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({
    where: { id, associationId },
    select: MEETING_WITH_PARTICIPANTS_SELECT,
  })

  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  return NextResponse.json(meeting)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const existing = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = meetingUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { status, endedAt, summary, transcript, title, description, type, scheduledAt, participantIds } = parsed.data

  const wantsStructuralChange = STRUCTURAL_FIELDS.some(f => parsed.data[f] !== undefined)
  if (wantsStructuralChange && existing.status !== "SCHEDULED") {
    return NextResponse.json(
      { error: "Impossible de modifier une réunion en cours ou terminée." },
      { status: 409 },
    )
  }

  if (participantIds !== undefined) {
    // Without this check, a membreId belonging to a different association — a valid row,
    // just not one this admin is allowed to see — would pass straight through to
    // createMany below and silently attach a foreign tenant's member as a participant here.
    const validCount = await prisma.membre.count({ where: { id: { in: participantIds }, associationId } })
    if (validCount !== participantIds.length) {
      return NextResponse.json({ error: "Un ou plusieurs membres sont introuvables." }, { status: 422 })
    }

    const current = await prisma.meetingParticipant.findMany({ where: { meetingId: id }, select: { membreId: true } })
    const currentIds = current.map(p => p.membreId)
    const toAdd = participantIds.filter(pid => !currentIds.includes(pid))
    await prisma.$transaction([
      prisma.meetingParticipant.deleteMany({ where: { meetingId: id, membreId: { notIn: participantIds } } }),
      prisma.meetingParticipant.createMany({
        data: toAdd.map(membreId => ({ meetingId: id, membreId })),
        skipDuplicates: true,
      }),
    ])

    // Mirrors the invite step on creation (POST /api/meetings) — without this, a member
    // added by editing an existing meeting would be silently attached with no email or
    // in-app notification telling them they've been invited.
    if (toAdd.length > 0) {
      const association = await prisma.association.findUnique({
        where: { id: associationId },
        select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
      })
      const newMembres = await prisma.membre.findMany({
        where: { id: { in: toAdd }, userId: { not: null } },
        include: { user: { select: { name: true, email: true } } },
      })
      const portalBase   = `${process.env.NEXTAUTH_URL ?? ""}/portal/${association?.slug}/reunions`
      const branding     = association ? resolveDocumentBranding(association) : null
      const finalTitle       = title ?? existing.title
      const finalScheduledAt = scheduledAt !== undefined
        ? (scheduledAt ? new Date(scheduledAt) : null)
        : existing.scheduledAt

      for (const m of newMembres) {
        if (!m.user?.email) continue
        void sendEmail(meetingInviteEmail({
          firstName:       m.firstName,
          email:           m.user.email,
          associationName: association?.name ?? "",
          meetingTitle:    finalTitle,
          scheduledAt:     finalScheduledAt,
          instant:         false,
          portalUrl:       portalBase,
          branding,
        }), { associationId, membreId: m.id, source: "MEETING_INVITE", sourceId: id })
      }

      await prisma.notification.createMany({
        data: newMembres
          .filter(m => m.userId)
          .map(m => ({
            userId: m.userId!,
            title:  `Nouvelle réunion : ${finalTitle}`,
            body:   "Vous avez été invité à une réunion.",
            link:   portalBase,
          })),
        skipDuplicates: true,
      })

      await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
    }
  }

  const meeting = await prisma.meeting.update({
    where: { id },
    data: {
      ...(status      !== undefined ? { status }                     : {}),
      ...(endedAt     !== undefined ? { endedAt: new Date(endedAt) } : {}),
      ...(summary     !== undefined ? { summary }                    : {}),
      ...(transcript  !== undefined ? { transcript }                : {}),
      ...(title       !== undefined ? { title }                     : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(type        !== undefined ? { type }                      : {}),
      ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}),
    },
    select: MEETING_WITH_PARTICIPANTS_SELECT,
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

import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { customEmail, escapeHtml } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { MEETING_WITH_PARTICIPANTS_SELECT } from "@/lib/meetings/select"
import { buildMeetingMinutesPdf } from "@/lib/pdf/meeting-minutes-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const schema = z.object({
  to:      z.string().trim().email("Email invalide"),
  message: z.string().trim().optional(),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const meeting = await prisma.meeting.findFirst({
    where:  { id, associationId },
    select: MEETING_WITH_PARTICIPANTS_SELECT,
  })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { to, message } = parsed.data

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  const branding = resolveDocumentBranding(association)

  const pdf = await buildMeetingMinutesPdf({
    title:       meeting.title,
    scheduledAt: meeting.scheduledAt,
    startedAt:   meeting.startedAt,
    endedAt:     meeting.endedAt,
    association: { name: association.name, ...branding },
    participants: meeting.participants.map(p => ({ firstName: p.membre.firstName, lastName: p.membre.lastName })),
    summary:     meeting.summary,
    transcript:  meeting.transcript,
  })

  const subject  = `Compte-rendu — ${meeting.title}`
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;">Bonjour,</p>
    <p style="margin:0 0 16px;font-size:15px;">Veuillez trouver ci-joint le compte-rendu de la réunion <strong>${escapeHtml(meeting.title)}</strong>.</p>
    ${message ? `<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">${escapeHtml(message)}</p>` : ""}
    <p style="margin:0;font-size:15px;">Cordialement,<br>${association.name}</p>
  `

  await sendEmail({
    ...customEmail({ associationName: association.name, subject, bodyHtml, recipientEmail: to, branding }),
    attachments: [{ filename: `compte_rendu_${meeting.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`, content: pdf }],
  }, { associationId, source: "DOCUMENT", sourceId: id })

  await writeActivityLog({ associationId, actorId: userId, action: "MEETING_MINUTES_EMAIL_SENT", entity: "Meeting", entityId: id, label: meeting.title })

  return NextResponse.json({ ok: true })
}, { roles: MANAGERS, module: "reunions" })

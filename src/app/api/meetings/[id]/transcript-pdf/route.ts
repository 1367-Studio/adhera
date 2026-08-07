import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { MEETING_WITH_PARTICIPANTS_SELECT } from "@/lib/meetings/select"
import { buildMeetingMinutesPdf } from "@/lib/pdf/meeting-minutes-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({
    where:  { id, associationId },
    select: MEETING_WITH_PARTICIPANTS_SELECT,
  })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const pdf = await buildMeetingMinutesPdf({
    title:       meeting.title,
    scheduledAt: meeting.scheduledAt,
    startedAt:   meeting.startedAt,
    endedAt:     meeting.endedAt,
    association: { name: association.name, ...resolveDocumentBranding(association) },
    participants: meeting.participants.map(p => ({ firstName: p.membre.firstName, lastName: p.membre.lastName })),
    summary:     meeting.summary,
    transcript:  meeting.transcript,
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="compte_rendu_${meeting.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf"`,
    },
  })
}, { roles: MANAGERS, module: "reunions" })

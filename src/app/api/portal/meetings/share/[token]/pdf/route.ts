import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { buildMeetingMinutesPdf } from "@/lib/pdf/meeting-minutes-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

export const GET = withPortalAuth<{ token: string }>(async (_req, ctx, { token }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findUnique({
    where:  { shareToken: token },
    select: {
      associationId: true, title: true, scheduledAt: true, startedAt: true, endedAt: true,
      summary: true, transcript: true, shareExpiresAt: true,
      participants: { select: { membre: { select: { firstName: true, lastName: true } } } },
    },
  })
  if (!meeting) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (meeting.associationId !== associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (meeting.shareExpiresAt && meeting.shareExpiresAt < new Date()) {
    return NextResponse.json({ error: "Lien expiré" }, { status: 410 })
  }

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
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
}, { requireMembre: false })

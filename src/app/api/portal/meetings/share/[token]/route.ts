import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { resolveDocumentBranding } from "@/lib/plan-limits"

export const GET = withPortalAuth<{ token: string }>(async (_req, ctx, { token }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findUnique({
    where:  { shareToken: token },
    select: { associationId: true, title: true, scheduledAt: true, startedAt: true, shareExpiresAt: true },
  })
  if (!meeting) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (meeting.associationId !== associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const expired = meeting.shareExpiresAt ? meeting.shareExpiresAt < new Date() : true

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })

  return NextResponse.json({
    title:       meeting.title,
    scheduledAt: meeting.scheduledAt,
    startedAt:   meeting.startedAt,
    expired,
    association: association ? { name: association.name, ...resolveDocumentBranding(association) } : null,
  })
}, { requireMembre: false })

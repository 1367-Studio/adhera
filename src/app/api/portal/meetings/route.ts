import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const membre = await prisma.membre.findUnique({ where: { id: ctx.membreId! }, select: { status: true } })

  // AG concerns the whole association, so an ACTIF member sees it — scheduled, live, or
  // ended — even if they weren't individually invited/tracked as a MeetingParticipant.
  // (The token route grants join access to the same class of member.) Bureau/Générale
  // meetings stay participant-only — those are working sessions for whoever was invited.
  const meetings = await prisma.meeting.findMany({
    where: {
      associationId: ctx.associationId,
      status: { in: ["SCHEDULED", "LIVE", "ENDED"] },
      OR: [
        { participants: { some: { membreId: ctx.membreId! } } },
        ...(membre?.status === "ACTIF" ? [{ type: "AG" as const }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      type: true,
      scheduledAt: true,
      startedAt: true,
      endedAt: true,
      roomName: true,
      summary: true,
    },
  })

  return NextResponse.json(meetings)
})

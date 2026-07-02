import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const meetings = await prisma.meeting.findMany({
    where: {
      associationId: ctx.associationId,
      status: { in: ["SCHEDULED", "LIVE", "ENDED"] },
      participants: { some: { membreId: ctx.membreId! } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      endedAt: true,
      roomName: true,
    },
  })

  return NextResponse.json(meetings)
})

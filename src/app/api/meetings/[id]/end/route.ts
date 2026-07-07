import { NextResponse } from "next/server"
import { EgressClient, RoomServiceClient } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { getLiveKitConfigForMeeting, LiveKitConfigError } from "@/lib/livekit/config"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  if (meeting.status === "ENDED") return NextResponse.json({ ok: true })

  let livekit
  try {
    livekit = await getLiveKitConfigForMeeting(meeting)
  } catch (err) {
    if (err instanceof LiveKitConfigError) return NextResponse.json({ error: err.message }, { status: 503 })
    throw err
  }

  if (meeting.egressId) {
    try {
      const egressClient = new EgressClient(livekit.url, livekit.apiKey, livekit.apiSecret)
      await egressClient.stopEgress(meeting.egressId)
    } catch {
      // Egress may have already stopped
    }
  }

  try {
    const roomClient = new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret)
    await roomClient.deleteRoom(meeting.roomName)
  } catch {
    // Room may already be empty/deleted
  }

  const { count } = await prisma.meeting.updateMany({
    where: { id, status: { not: "ENDED" } },
    data:  { egressId: null, status: "ENDED", endedAt: new Date() },
  })

  if (count > 0) {
    await writeActivityLog({
      associationId,
      actorId: ctx.userId,
      action:  "MEETING_ENDED",
      entity:  "Meeting",
      entityId: id,
      label:   meeting.title,
    })
  }

  return NextResponse.json({ ok: true })
}, { roles: MANAGERS, module: "reunions" })

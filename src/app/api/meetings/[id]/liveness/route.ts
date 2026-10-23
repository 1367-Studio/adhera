import { NextResponse } from "next/server"
import { RoomServiceClient } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { reportError } from "@/lib/monitoring"
import { getLiveKitConfigForMeeting, LiveKitConfigError } from "@/lib/livekit/config"

// Ground-truths a meeting's `status: "LIVE"` against the actual LiveKit room before anything
// (the "already have a meeting running" warning on creation, a manual rejoin) acts on it. The
// webhook that normally flips a meeting to ENDED when its room empties out depends on delivery
// — a dropped/delayed webhook leaves the DB saying LIVE forever, which would otherwise lead
// someone to "rejoin" a meeting that's actually long gone (LiveKit just silently hands them a
// fresh, empty room under the same name instead of reconnecting them to anything). Absence of
// participants alone doesn't mean that, though — the room can legitimately sit empty for the
// reconnect grace period (see ensureRoomReconnectGrace) — only the room no longer existing at
// all in LiveKit does.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  if (meeting.status !== "LIVE") return NextResponse.json({ open: false })

  let livekit
  try {
    livekit = await getLiveKitConfigForMeeting(meeting)
  } catch (err) {
    if (err instanceof LiveKitConfigError) return NextResponse.json({ error: err.message }, { status: 503 })
    throw err
  }

  try {
    const roomClient = new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret)
    const rooms = await roomClient.listRooms([meeting.roomName])
    if (rooms.length > 0) return NextResponse.json({ open: true })
  } catch (err) {
    // Couldn't reach LiveKit to check — fail open rather than tell someone their meeting is
    // over when we simply don't know.
    reportError(err, { area: "api", action: "livekit.liveness-check", extra: { associationId, meetingId: id } })
    return NextResponse.json({ open: true })
  }

  // Room is confirmed gone but our own webhook never closed it out — self-heal instead of
  // leaving the DB saying LIVE forever.
  const { count } = await prisma.meeting.updateMany({
    where: { id, status: { not: "ENDED" } },
    data:  { status: "ENDED", endedAt: new Date() },
  })

  if (count > 0) {
    await writeActivityLog({
      associationId,
      actorId:  ctx.userId,
      action:   "MEETING_ENDED",
      entity:   "Meeting",
      entityId: id,
      label:    meeting.title,
      metadata: { reason: "liveness_check_self_heal" },
    })
    await pusherServer
      .trigger(`private-association-${associationId}`, "meeting-ended", { meetingId: id })
      .catch(() => {})
  }

  return NextResponse.json({ open: false })
}, { area: "reunions", access: "read", module: "reunions" })

import { NextResponse } from "next/server"
import { WebhookReceiver, EgressClient, RoomServiceClient } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"

export const dynamic = "force-dynamic"

const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET
const receiver = LIVEKIT_API_KEY && LIVEKIT_API_SECRET
  ? new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null

// Fallback close for meetings nobody explicitly ended via the "Encerrer" button (e.g. every
// participant just clicked "Quitter", or a browser crashed). Only acts on `room_finished`,
// which LiveKit itself only fires once a room has stayed empty for its emptyTimeout — it
// debounces/cancels this on its own if a participant rejoins in the meantime. We deliberately
// don't act on `participant_left` directly: a page refresh or brief reconnect blip also fires
// that event and can momentarily report zero participants, which would end a meeting that's
// still actually in progress.
async function endMeetingByRoomName(roomName: string) {
  const meeting = await prisma.meeting.findUnique({ where: { roomName } })
  if (!meeting || meeting.status === "ENDED") return

  if (meeting.egressId) {
    try {
      const egressClient = new EgressClient(process.env.LIVEKIT_URL!, LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!)
      await egressClient.stopEgress(meeting.egressId)
    } catch {
      // Egress may have already stopped
    }
  }

  // room_finished means LiveKit already tore the room down itself — no deleteRoom needed here.

  const { count } = await prisma.meeting.updateMany({
    where: { id: meeting.id, status: { not: "ENDED" } },
    data:  { egressId: null, status: "ENDED", endedAt: new Date() },
  })

  if (count > 0) {
    await writeActivityLog({
      associationId: meeting.associationId,
      action:  "MEETING_ENDED",
      entity:  "Meeting",
      entityId: meeting.id,
      label:   meeting.title,
      metadata: { reason: "livekit_webhook_auto_close" },
    })

    // Lets any dashboard/portal tab already open on this association refresh its meeting
    // list immediately instead of waiting on the next window refocus/remount to notice.
    await pusherServer
      .trigger(`private-association-${meeting.associationId}`, "meeting-ended", { meetingId: meeting.id })
      .catch(() => {})
  }
}

export async function POST(req: Request) {
  if (!receiver) {
    console.error("LiveKit webhook: LIVEKIT_API_KEY/LIVEKIT_API_SECRET missing, cannot verify events")
    return NextResponse.json({ error: "Webhook misconfigured" }, { status: 500 })
  }

  const body = await req.text()
  const authHeader = req.headers.get("Authorization") ?? undefined

  let event
  try {
    event = await receiver.receive(body, authHeader)
  } catch (err) {
    console.error("LiveKit webhook: signature verification failed", err)
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 })
  }

  const roomName = event.room?.name
  if (roomName && event.event === "room_finished") {
    await endMeetingByRoomName(roomName)
  }

  return NextResponse.json({ received: true })
}

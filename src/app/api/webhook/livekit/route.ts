import { NextResponse } from "next/server"
import { WebhookReceiver, EgressClient, type WebhookEvent } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"
import { getLiveKitConfigForRoom } from "@/lib/livekit/config"

export const dynamic = "force-dynamic"

// Only used to parse the payload far enough to read `room.name` before we know which
// LiveKit account it belongs to — verification never happens against these placeholder
// credentials (see verifyEvent's skipAuth pass below).
const bootstrapReceiver = new WebhookReceiver("unverified", "unverified")

type VerifyResult =
  | { ok: true; event: WebhookEvent }
  | { ok: false; reason: "malformed_payload" }
  | { ok: false; reason: "unknown_room"; roomName: string }
  | { ok: false; reason: "signature_mismatch"; roomName: string }

// An association can bring its own LiveKit project (BYOK, same as the Twilio/Groq
// integrations), which means events for its meetings arrive signed with *its* key, not the
// platform's. We can't know which key to verify with until we know which room the event is
// about — so we parse once unauthenticated just to read the room name, look up which
// association owns it, then re-verify the same payload for real with that account's secret
// (falling back to the platform's) before trusting anything in it.
async function verifyEvent(body: string, authHeader: string | undefined): Promise<VerifyResult> {
  let unverified: WebhookEvent
  try {
    unverified = await bootstrapReceiver.receive(body, authHeader, true)
  } catch {
    return { ok: false, reason: "malformed_payload" }
  }

  const roomName = unverified.room?.name
  if (!roomName) return { ok: false, reason: "malformed_payload" }

  const livekit = await getLiveKitConfigForRoom(roomName)
  if (!livekit) return { ok: false, reason: "unknown_room", roomName }

  try {
    const receiver = new WebhookReceiver(livekit.apiKey, livekit.apiSecret)
    const event = await receiver.receive(body, authHeader)
    return { ok: true, event }
  } catch {
    return { ok: false, reason: "signature_mismatch", roomName }
  }
}

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
      const livekit = await getLiveKitConfigForRoom(roomName)
      if (livekit) {
        const egressClient = new EgressClient(livekit.url, livekit.apiKey, livekit.apiSecret)
        await egressClient.stopEgress(meeting.egressId)
      }
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
  const body = await req.text()
  const authHeader = req.headers.get("Authorization") ?? undefined

  const result = await verifyEvent(body, authHeader)
  if (!result.ok) {
    switch (result.reason) {
      case "malformed_payload":
        console.error("LiveKit webhook: malformed payload (couldn't parse room name)")
        break
      case "unknown_room":
        console.error(`LiveKit webhook: no meeting matches room "${result.roomName}" (deleted meeting or stray webhook?)`)
        break
      case "signature_mismatch":
        console.error(`LiveKit webhook: signature mismatch for room "${result.roomName}" — payload doesn't match the account on file for that meeting`)
        break
    }
    // Response stays generic regardless of cause — no need to tell a caller which of these
    // failure modes it hit.
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 })
  }

  const { event } = result
  const roomName = event.room?.name
  if (roomName && event.event === "room_finished") {
    await endMeetingByRoomName(roomName)
  }

  return NextResponse.json({ received: true })
}

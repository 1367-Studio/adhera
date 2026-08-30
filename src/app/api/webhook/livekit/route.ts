import { NextResponse } from "next/server"
import { WebhookReceiver, EgressClient, TrackType, type WebhookEvent } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { pusherServer } from "@/lib/pusher-server"
import { getLiveKitConfigForRoom } from "@/lib/livekit/config"
import { startParticipantAudioEgress } from "@/lib/livekit/egress"

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

  const openRecordings = await prisma.meetingRecording.findMany({ where: { meetingId: meeting.id, endedAt: null } })
  if (openRecordings.length > 0) {
    try {
      const livekit = await getLiveKitConfigForRoom(roomName)
      if (livekit) {
        const egressClient = new EgressClient(livekit.url, livekit.apiKey, livekit.apiSecret)
        await Promise.all(openRecordings.map(r => egressClient.stopEgress(r.egressId).catch(() => {})))
      }
    } catch {
      // Egress may have already stopped
    }
    await prisma.meetingRecording.updateMany({
      where: { id: { in: openRecordings.map(r => r.id) } },
      data:  { endedAt: new Date() },
    })
  }

  // room_finished means LiveKit already tore the room down itself — no deleteRoom needed here.

  const { count } = await prisma.meeting.updateMany({
    where: { id: meeting.id, status: { not: "ENDED" } },
    data:  { status: "ENDED", endedAt: new Date() },
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

// LiveKit's egress binds to a track, not to a room: POST /api/meetings/[id]/egress can only
// cover the mic tracks that already existed when someone pressed "Enregistrer". Anyone
// joining afterwards would be absent from the recording — and therefore from the transcript
// and the compte rendu built on it — which is precisely what happens when the host is asked
// to start recording as they arrive, before anyone else is there. Their mic publishing is
// the earliest moment an egress can attach to them, so this hooks `track_published` rather
// than `participant_joined` (at join time there is no track id to record yet).
async function recordLateJoiner(event: WebhookEvent, roomName: string) {
  const track = event.track
  if (!track || track.type !== TrackType.AUDIO) return

  const identity = event.participant?.identity
  if (!identity) return

  const meeting = await prisma.meeting.findUnique({ where: { roomName } })
  if (!meeting || meeting.status === "ENDED") return

  // Only ever join a recording already in progress — never start one off the back of a
  // webhook, or a meeting the host declined to record would quietly record itself.
  const active = await prisma.meetingRecording.findFirst({
    where: { meetingId: meeting.id, endedAt: null },
  })
  if (!active) return

  // Republished track, reconnect, or a duplicate delivery of the same event: LiveKit
  // retries webhooks, and a second egress on one participant would bill twice and put the
  // same voice in the transcript twice.
  const already = await prisma.meetingRecording.findFirst({
    where: { meetingId: meeting.id, identity, endedAt: null },
  })
  if (already) return

  const livekit = await getLiveKitConfigForRoom(roomName)
  if (!livekit) return

  try {
    const started = await startParticipantAudioEgress({
      livekit,
      roomName,
      meetingId:    meeting.id,
      identity,
      displayName:  event.participant?.name || identity,
      audioTrackId: track.sid,
    })
    await prisma.meetingRecording.create({ data: { meetingId: meeting.id, ...started } })
  } catch (err) {
    // Never fail the webhook over this: the meeting itself is unaffected, this participant
    // is just missing from the transcript.
    console.error(`LiveKit webhook: couldn't start egress for late joiner "${identity}" in room "${roomName}"`, err)
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

  if (roomName && event.event === "track_published") {
    await recordLateJoiner(event, roomName)
  }

  return NextResponse.json({ received: true })
}

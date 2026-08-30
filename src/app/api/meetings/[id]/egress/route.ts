import { NextResponse } from "next/server"
import { RoomServiceClient, TrackType } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { getLiveKitConfigForMeeting, LiveKitConfigError, type LiveKitConfig } from "@/lib/livekit/config"
import { makeEgressClient, startParticipantAudioEgress, type StartedRecording } from "@/lib/livekit/egress"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

function makeRoomServiceClient(livekit: LiveKitConfig) {
  return new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret)
}

// Room metadata is pushed live to every connected participant by LiveKit itself — this is
// what the client reads (via useRoomInfo) to show the "recording" banner in real time,
// instead of the old per-client local state that only the admin who clicked ever saw.
async function setRoomRecordingMetadata(livekit: LiveKitConfig, roomName: string, recording: boolean) {
  try {
    const roomClient = makeRoomServiceClient(livekit)
    await roomClient.updateRoomMetadata(roomName, JSON.stringify({ recording }))
  } catch {
    // Non-fatal: egress itself already started/stopped; worst case the live banner lags.
  }
}

// POST — start recording: one egress per participant currently in the room, so each
// person's audio ends up in its own file — needed to later attribute transcript text to
// whoever actually said it. Participants who join *after* this point are picked up by the
// `track_published` handler in the LiveKit webhook, which starts the same egress for them.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const alreadyRecording = await prisma.meetingRecording.findFirst({ where: { meetingId: id, endedAt: null } })
  if (alreadyRecording) {
    return NextResponse.json({ recording: true })
  }

  let livekit
  try {
    livekit = await getLiveKitConfigForMeeting(meeting)
  } catch (err) {
    if (err instanceof LiveKitConfigError) return NextResponse.json({ error: err.message }, { status: 503 })
    throw err
  }

  const roomClient   = makeRoomServiceClient(livekit)
  const participants = await roomClient.listParticipants(meeting.roomName)

  const started: StartedRecording[] = []

  for (const participant of participants) {
    const audioTrack = participant.tracks.find(t => t.type === TrackType.AUDIO)
    if (!audioTrack) continue // joined without publishing a mic track — nothing to record

    started.push(await startParticipantAudioEgress({
      livekit,
      roomName:     meeting.roomName,
      meetingId:    id,
      identity:     participant.identity,
      displayName:  participant.name || participant.identity,
      audioTrackId: audioTrack.sid,
    }))
  }

  if (started.length === 0) {
    return NextResponse.json({ error: "Aucun participant avec micro actif à enregistrer." }, { status: 422 })
  }

  await prisma.meetingRecording.createMany({
    data: started.map(s => ({ meetingId: id, ...s })),
  })

  await setRoomRecordingMetadata(livekit, meeting.roomName, true)

  await prisma.meeting.update({
    where: { id },
    data:  { status: "LIVE", startedAt: meeting.startedAt ?? new Date() },
  })

  await writeActivityLog({
    associationId,
    actorId: ctx.userId,
    action:  "MEETING_RECORDING_STARTED",
    entity:  "Meeting",
    entityId: id,
    label:   meeting.title,
  })

  return NextResponse.json({ recording: true, count: started.length })
}, { roles: MANAGERS, module: "reunions" })

// DELETE — stop recording: stop every still-open per-participant egress for this meeting
export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const openRecordings = await prisma.meetingRecording.findMany({ where: { meetingId: id, endedAt: null } })

  if (openRecordings.length > 0) {
    try {
      const livekit      = await getLiveKitConfigForMeeting(meeting)
      const egressClient = makeEgressClient(livekit)
      await Promise.all(openRecordings.map(r => egressClient.stopEgress(r.egressId).catch(() => {})))
      await setRoomRecordingMetadata(livekit, meeting.roomName, false)
    } catch {
      // Egress may have already stopped (room empty, timeout, etc.), or LiveKit not configured
    }

    await prisma.meetingRecording.updateMany({
      where: { id: { in: openRecordings.map(r => r.id) } },
      data:  { endedAt: new Date() },
    })
  }

  await writeActivityLog({
    associationId,
    actorId: ctx.userId,
    action:  "MEETING_RECORDING_STOPPED",
    entity:  "Meeting",
    entityId: id,
    label:   meeting.title,
  })

  return NextResponse.json({ recording: false })
}, { roles: MANAGERS, module: "reunions" })

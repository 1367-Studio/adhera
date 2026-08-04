import { NextResponse } from "next/server"
import { EgressClient, RoomServiceClient, EncodedFileOutput, EncodedFileType, S3Upload, TrackType } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { getLiveKitConfigForMeeting, LiveKitConfigError, type LiveKitConfig } from "@/lib/livekit/config"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

function makeEgressClient(livekit: LiveKitConfig) {
  return new EgressClient(livekit.url, livekit.apiKey, livekit.apiSecret)
}

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

function makeS3Upload() {
  return new S3Upload({
    accessKey:      process.env.R2_ACCESS_KEY_ID!,
    secret:         process.env.R2_SECRET_ACCESS_KEY!,
    bucket:         process.env.R2_BUCKET_NAME!,
    region:         "auto",
    endpoint:       `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
  })
}

// POST — start recording: one egress per participant currently in the room, so each
// person's audio ends up in its own file — needed to later attribute transcript text to
// whoever actually said it. Anyone who joins after this point isn't captured individually;
// that's a known gap, tracked for a follow-up rather than solved here.
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
  const egressClient = makeEgressClient(livekit)
  const participants = await roomClient.listParticipants(meeting.roomName)

  const started: { identity: string; displayName: string; egressId: string; recordingKey: string }[] = []

  for (const participant of participants) {
    const audioTrack = participant.tracks.find(t => t.type === TrackType.AUDIO)
    if (!audioTrack) continue // joined without publishing a mic track — nothing to record

    const recordingKey = `meetings/${id}/recording-${participant.identity}-${Date.now()}.ogg`

    const info = await egressClient.startTrackCompositeEgress(
      meeting.roomName,
      new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: recordingKey,
        output:   { case: "s3", value: makeS3Upload() },
      }),
      { audioTrackId: audioTrack.sid },
    )

    started.push({
      identity:    participant.identity,
      displayName: participant.name || participant.identity,
      egressId:    info.egressId,
      recordingKey,
    })
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

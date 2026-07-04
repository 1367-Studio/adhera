import { NextResponse } from "next/server"
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

function makeEgressClient() {
  return new EgressClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
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

// POST — start recording
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  if (meeting.egressId) {
    return NextResponse.json({ egressId: meeting.egressId, recordingKey: meeting.recordingKey })
  }

  const recordingKey = `meetings/${id}/recording-${Date.now()}.ogg`

  const egressClient = makeEgressClient()
  const info = await egressClient.startRoomCompositeEgress(
    meeting.roomName,
    new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath:  recordingKey,
      output:    { case: "s3", value: makeS3Upload() },
    }),
    { audioOnly: true },
  )

  await prisma.meeting.update({
    where: { id },
    data:  {
      egressId:    info.egressId,
      recordingKey,
      status:      "LIVE",
      startedAt:   meeting.startedAt ?? new Date(),
    },
  })

  await writeActivityLog({
    associationId,
    actorId: ctx.userId,
    action:  "MEETING_RECORDING_STARTED",
    entity:  "Meeting",
    entityId: id,
    label:   meeting.title,
  })

  return NextResponse.json({ egressId: info.egressId, recordingKey })
}, { roles: MANAGERS, module: "reunions" })

// DELETE — stop recording
export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  if (meeting.egressId) {
    try {
      const egressClient = makeEgressClient()
      await egressClient.stopEgress(meeting.egressId)
    } catch {
      // Egress may have already stopped (room empty, timeout, etc.)
    }
  }

  await prisma.meeting.update({
    where: { id },
    data:  { egressId: null },
  })

  await writeActivityLog({
    associationId,
    actorId: ctx.userId,
    action:  "MEETING_RECORDING_STOPPED",
    entity:  "Meeting",
    entityId: id,
    label:   meeting.title,
  })

  return NextResponse.json({ recordingKey: meeting.recordingKey })
}, { roles: MANAGERS, module: "reunions" })

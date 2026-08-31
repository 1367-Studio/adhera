import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "livekit-server-sdk"
import type { LiveKitConfig } from "./config"

export function makeEgressClient(livekit: LiveKitConfig) {
  return new EgressClient(livekit.url, livekit.apiKey, livekit.apiSecret)
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

export type StartedRecording = {
  identity:     string
  displayName:  string
  egressId:     string
  recordingKey: string
}

// One audio-only egress for a single participant's mic track — the unit both the manual
// "Enregistrer" button (every participant present at that moment) and the late-joiner
// webhook work in. Kept here rather than duplicated so the R2 destination and the key
// naming the transcription route reads back can't drift apart between the two callers.
export async function startParticipantAudioEgress({
  livekit,
  roomName,
  meetingId,
  identity,
  displayName,
  audioTrackId,
}: {
  livekit:      LiveKitConfig
  roomName:     string
  meetingId:    string
  identity:     string
  displayName:  string
  audioTrackId: string
}): Promise<StartedRecording> {
  const recordingKey = `meetings/${meetingId}/recording-${identity}-${Date.now()}.ogg`

  const info = await makeEgressClient(livekit).startTrackCompositeEgress(
    roomName,
    new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: recordingKey,
      output:   { case: "s3", value: makeS3Upload() },
    }),
    { audioTrackId },
  )

  return { identity, displayName, egressId: info.egressId, recordingKey }
}

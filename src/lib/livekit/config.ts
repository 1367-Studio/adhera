import { prisma } from "@/lib/prisma/client"

export class LiveKitConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LiveKitConfigError"
  }
}

export type LiveKitConfig = {
  url:            string
  apiKey:         string
  apiSecret:      string
  usingPlatform:  boolean
}

const PLATFORM_URL        = process.env.LIVEKIT_URL
const PLATFORM_API_KEY    = process.env.LIVEKIT_API_KEY
const PLATFORM_API_SECRET = process.env.LIVEKIT_API_SECRET

// Bring-your-own-account, same shape as the Twilio (SMS) and Groq (AI) integrations: if the
// association configured its own LiveKit project, meetings run on their account and their
// LiveKit bill — no cap on our end. Otherwise they fall back to the platform's shared
// project, whose own plan ceiling is the only limit (LiveKit itself will error once that's
// exhausted, same as the platform Groq key running into its rate limit).
export async function getLiveKitConfig(associationId: string): Promise<LiveKitConfig> {
  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { livekitUrl: true, livekitApiKey: true, livekitApiSecret: true },
  })

  if (assoc?.livekitUrl && assoc.livekitApiKey && assoc.livekitApiSecret) {
    return {
      url:           assoc.livekitUrl,
      apiKey:        assoc.livekitApiKey,
      apiSecret:     assoc.livekitApiSecret,
      usingPlatform: false,
    }
  }

  if (!PLATFORM_URL || !PLATFORM_API_KEY || !PLATFORM_API_SECRET) {
    throw new LiveKitConfigError("LiveKit non configuré.")
  }

  return {
    url:           PLATFORM_URL,
    apiKey:        PLATFORM_API_KEY,
    apiSecret:     PLATFORM_API_SECRET,
    usingPlatform: true,
  }
}

type MeetingLiveKitFields = {
  id:               string
  associationId:    string
  livekitUrl:       string | null
  livekitApiKey:    string | null
  livekitApiSecret: string | null
}

function fromSnapshot(meeting: MeetingLiveKitFields): LiveKitConfig | null {
  if (!meeting.livekitUrl || !meeting.livekitApiKey || !meeting.livekitApiSecret) return null
  return {
    url:           meeting.livekitUrl,
    apiKey:        meeting.livekitApiKey,
    apiSecret:     meeting.livekitApiSecret,
    usingPlatform: meeting.livekitApiKey === PLATFORM_API_KEY,
  }
}

// Resolves (and pins) which LiveKit account a specific meeting's room actually lives on.
// The association's own LiveKit settings can change (or be removed) at any time, but a
// meeting's room was created on whichever account was active the first time someone joined
// — re-resolving live on every call would silently point later join/end/egress calls at a
// different account than the one the room actually runs on. So the first resolution is
// snapshotted onto the Meeting row and reused for the rest of its lifetime.
export async function getLiveKitConfigForMeeting(meeting: MeetingLiveKitFields): Promise<LiveKitConfig> {
  const pinned = fromSnapshot(meeting)
  if (pinned) return pinned

  const resolved = await getLiveKitConfig(meeting.associationId)

  await prisma.meeting.update({
    where: { id: meeting.id },
    data:  { livekitUrl: resolved.url, livekitApiKey: resolved.apiKey, livekitApiSecret: resolved.apiSecret },
  }).catch(() => {
    // Best-effort: if the pin write fails, this call still gets a valid config: worst case
    // the next call re-resolves live and tries to pin again.
  })

  return resolved
}

// Looks up which LiveKit account owns a given room, by walking back from the room name to
// its Meeting — used by the webhook, which doesn't know the association up front (LiveKit
// signs the payload with whichever project's secret matches the room). Prefers the
// meeting's pinned snapshot; only resolves live (without pinning — the webhook shouldn't
// have side effects on config) for meetings created before this snapshot existed.
export async function getLiveKitConfigForRoom(roomName: string): Promise<LiveKitConfig | null> {
  const meeting = await prisma.meeting.findUnique({
    where:  { roomName },
    select: { id: true, associationId: true, livekitUrl: true, livekitApiKey: true, livekitApiSecret: true },
  })
  if (!meeting) return null

  return fromSnapshot(meeting) ?? getLiveKitConfig(meeting.associationId)
}

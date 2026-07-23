import type { Prisma } from "@prisma/client"

// Excludes livekitUrl/livekitApiKey/livekitApiSecret — those are internal credentials
// used server-side only (see src/lib/livekit/config.ts) and must never reach the client.
export const MEETING_SAFE_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  type: true,
  scheduledAt: true,
  startedAt: true,
  endedAt: true,
  roomName: true,
  createdById: true,
  transcript: true,
  summary: true,
  egressId: true,
  recordingKey: true,
  createdAt: true,
} satisfies Prisma.MeetingSelect

export const MEETING_WITH_PARTICIPANTS_SELECT = {
  ...MEETING_SAFE_SELECT,
  participants: {
    include: { membre: { select: { id: true, firstName: true, lastName: true } } },
  },
} satisfies Prisma.MeetingSelect

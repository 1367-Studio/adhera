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
    include: { membre: { select: { id: true, firstName: true, lastName: true, status: true } } },
  },
} satisfies Prisma.MeetingSelect

type MeetingWithParticipants = Prisma.MeetingGetPayload<{ select: typeof MEETING_WITH_PARTICIPANTS_SELECT }>
type MeetingWithRedactedParticipants = Omit<MeetingWithParticipants, "participants"> & {
  participants: (Omit<MeetingWithParticipants["participants"][number], "membre"> & {
    membre: Omit<MeetingWithParticipants["participants"][number]["membre"], "status"> & { status: null }
  })[]
}

// membre.status (PENDING/ACTIF/INACTIF/SUSPENDU) only exists in this select to build the
// manager-only attendance-sheet PDF — regular members hitting these same GET routes to view
// a meeting they're part of shouldn't see whether a fellow participant is suspended/inactive.
export function redactParticipantStatus(
  meeting: MeetingWithParticipants,
  viewerRole: string,
  managerRoles: readonly string[],
): MeetingWithParticipants | MeetingWithRedactedParticipants {
  if (managerRoles.includes(viewerRole)) return meeting
  return {
    ...meeting,
    participants: meeting.participants.map(p => ({
      ...p,
      membre: { id: p.membre.id, firstName: p.membre.firstName, lastName: p.membre.lastName, status: null },
    })),
  }
}

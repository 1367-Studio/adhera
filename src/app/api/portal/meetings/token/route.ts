import { NextResponse } from "next/server"
import { AccessToken } from "livekit-server-sdk"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { getLiveKitConfigForMeeting, LiveKitConfigError } from "@/lib/livekit/config"

export const POST = withPortalAuth(async (req, ctx) => {
  const { associationId, membreId } = ctx

  const { meetingId } = await req.json()
  if (!meetingId) return NextResponse.json({ error: "meetingId requis" }, { status: 422 })

  const membre = await prisma.membre.findUnique({
    where:  { id: membreId! },
    select: { id: true, firstName: true, lastName: true, status: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const meetingSelect = {
    id: true, roomName: true, associationId: true, status: true, type: true,
    livekitUrl: true, livekitApiKey: true, livekitApiSecret: true,
  } as const

  let participant = await prisma.meetingParticipant.findFirst({
    where: { meetingId, membreId: membre.id },
    include: { meeting: { select: meetingSelect } },
  })

  // AG concerns the whole association: an ACTIF member who wasn't individually invited
  // can still join, same class of access as the portal meetings list grants them. Their
  // participant row is created on first join so attendance is tracked like anyone else's.
  if (!participant && membre.status === "ACTIF") {
    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingId, associationId, type: "AG" },
      select: meetingSelect,
    })
    if (meeting) {
      participant = await prisma.meetingParticipant.create({
        data: { meetingId, membreId: membre.id },
        include: { meeting: { select: meetingSelect } },
      })
    }
  }

  if (!participant || participant.meeting.associationId !== associationId) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  }
  if (participant.meeting.status === "ENDED" || participant.meeting.status === "CANCELLED") {
    return NextResponse.json({ error: "Cette réunion est terminée" }, { status: 403 })
  }

  let livekit
  try {
    livekit = await getLiveKitConfigForMeeting(participant.meeting)
  } catch (err) {
    if (err instanceof LiveKitConfigError) return NextResponse.json({ error: err.message }, { status: 503 })
    throw err
  }

  // Only recorded once the join is actually going to succeed — an early write here would
  // mark the meeting LIVE (and this membre as joined) even if the LiveKit config turns out
  // to be broken and no one ends up in the room.
  await prisma.meetingParticipant.update({
    where: { id: participant.id },
    data:  { joinedAt: new Date() },
  })
  if (participant.meeting.status === "SCHEDULED") {
    await prisma.meeting.update({
      where: { id: meetingId },
      data:  { status: "LIVE", startedAt: new Date() },
    })
  }

  const identity = `membre-${membre.id}`
  const name     = `${membre.firstName} ${membre.lastName}`

  const at = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity,
    name,
    ttl: "4h",
  })
  at.addGrant({ roomJoin: true, room: participant.meeting.roomName, canPublish: true, canSubscribe: true })

  const token = await at.toJwt()
  return NextResponse.json({ token, roomName: participant.meeting.roomName, serverUrl: livekit.url })
}, { module: "reunions" })

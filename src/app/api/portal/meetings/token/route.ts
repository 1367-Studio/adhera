import { NextResponse } from "next/server"
import { AccessToken } from "livekit-server-sdk"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string; associationId?: string | null }

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { meetingId } = await req.json()
  if (!meetingId) return NextResponse.json({ error: "meetingId requis" }, { status: 422 })

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const participant = await prisma.meetingParticipant.findFirst({
    where: { meetingId, membreId: membre.id },
    include: { meeting: { select: { roomName: true, associationId: true, status: true } } },
  })
  if (!participant || participant.meeting.associationId !== u.associationId) {
    return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  }
  if (participant.meeting.status === "ENDED" || participant.meeting.status === "CANCELLED") {
    return NextResponse.json({ error: "Cette réunion est terminée" }, { status: 403 })
  }

  // Mark join time
  await prisma.meetingParticipant.update({
    where: { id: participant.id },
    data:  { joinedAt: new Date() },
  })

  // Update meeting to LIVE if still SCHEDULED
  if (participant.meeting.status === "SCHEDULED") {
    await prisma.meeting.update({
      where: { id: meetingId },
      data:  { status: "LIVE", startedAt: new Date() },
    })
  }

  const identity = `membre-${membre.id}`
  const name     = `${membre.firstName} ${membre.lastName}`

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity,
    name,
    ttl: "4h",
  })
  at.addGrant({ roomJoin: true, room: participant.meeting.roomName, canPublish: true, canSubscribe: true })

  const token = await at.toJwt()
  return NextResponse.json({ token, roomName: participant.meeting.roomName, serverUrl: process.env.LIVEKIT_URL })
}

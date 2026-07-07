import { NextResponse } from "next/server"
import { AccessToken } from "livekit-server-sdk"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { getLiveKitConfigForMeeting, LiveKitConfigError } from "@/lib/livekit/config"

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const { meetingId } = await req.json()
  if (!meetingId) return NextResponse.json({ error: "meetingId requis" }, { status: 422 })

  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  if (meeting.status === "ENDED" || meeting.status === "CANCELLED") {
    return NextResponse.json({ error: "Cette réunion est terminée" }, { status: 403 })
  }

  let livekit
  try {
    livekit = await getLiveKitConfigForMeeting(meeting)
  } catch (err) {
    if (err instanceof LiveKitConfigError) return NextResponse.json({ error: err.message }, { status: 503 })
    throw err
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  const identity = userId
  const name = user?.name ?? user?.email ?? identity

  const at = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity,
    name,
    ttl: "4h",
  })
  at.addGrant({ roomJoin: true, room: meeting.roomName, canPublish: true, canSubscribe: true })

  const token = await at.toJwt()
  return NextResponse.json({ token, roomName: meeting.roomName, serverUrl: livekit.url })
}, { module: "reunions" })

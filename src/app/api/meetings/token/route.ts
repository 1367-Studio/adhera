import { NextResponse } from "next/server"
import { AccessToken } from "livekit-server-sdk"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, userId } = ctx

  const guard = await guardModule(associationId, "reunions")
  if (guard) return guard

  const { meetingId } = await req.json()
  if (!meetingId) return NextResponse.json({ error: "meetingId requis" }, { status: 422 })

  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  if (meeting.status === "ENDED" || meeting.status === "CANCELLED") {
    return NextResponse.json({ error: "Cette réunion est terminée" }, { status: 403 })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  const identity = userId
  const name = user?.name ?? user?.email ?? identity

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity,
    name,
    ttl: "4h",
  })
  at.addGrant({ roomJoin: true, room: meeting.roomName, canPublish: true, canSubscribe: true })

  const token = await at.toJwt()
  return NextResponse.json({ token, roomName: meeting.roomName, serverUrl: process.env.LIVEKIT_URL })
}

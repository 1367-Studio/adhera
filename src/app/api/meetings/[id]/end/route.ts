import { NextResponse } from "next/server"
import { EgressClient, RoomServiceClient } from "livekit-server-sdk"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  if (meeting.egressId) {
    try {
      const egressClient = new EgressClient(
        process.env.LIVEKIT_URL!,
        process.env.LIVEKIT_API_KEY!,
        process.env.LIVEKIT_API_SECRET!,
      )
      await egressClient.stopEgress(meeting.egressId)
    } catch {
      // Egress may have already stopped
    }
  }

  try {
    const roomClient = new RoomServiceClient(
      process.env.LIVEKIT_URL!,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    )
    await roomClient.deleteRoom(meeting.roomName)
  } catch {
    // Room may already be empty/deleted
  }

  await prisma.meeting.update({
    where: { id },
    data:  { egressId: null, status: "ENDED", endedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}

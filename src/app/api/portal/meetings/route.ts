import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string; associationId?: string | null }

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const meetings = await prisma.meeting.findMany({
    where: {
      associationId: u.associationId,
      status: { in: ["SCHEDULED", "LIVE"] },
      participants: { some: { membreId: membre.id } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      roomName: true,
    },
  })

  return NextResponse.json(meetings)
}

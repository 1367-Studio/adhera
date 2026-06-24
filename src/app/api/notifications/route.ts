import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string }

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  const notifications = await prisma.notification.findMany({
    where:   { userId: u.id! },
    orderBy: { createdAt: "desc" },
    take:    50,
  })
  return NextResponse.json(notifications)
}

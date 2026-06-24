import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string }

export async function POST() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  await prisma.notification.updateMany({
    where: { userId: u.id!, read: false },
    data:  { read: true },
  })
  return NextResponse.json({ ok: true })
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"

type SessionUser = { id?: string }

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u    = session.user as SessionUser
  const { id } = await params

  const notif = await prisma.notification.findFirst({ where: { id, userId: u.id! } })
  if (!notif) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.notification.update({ where: { id }, data: { read: true } })
  return NextResponse.json({ ok: true })
}

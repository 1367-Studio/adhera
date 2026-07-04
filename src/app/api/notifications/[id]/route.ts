import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const PATCH = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { userId } = ctx

  const notif = await prisma.notification.findFirst({ where: { id, userId } })
  if (!notif) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.notification.update({ where: { id }, data: { read: true } })
  return NextResponse.json({ ok: true })
})

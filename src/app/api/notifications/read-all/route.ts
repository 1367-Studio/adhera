import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const POST = withAdminAuth(async (_req, ctx) => {
  const { userId } = ctx

  await prisma.notification.updateMany({
    where: { userId, read: false },
    data:  { read: true },
  })
  return NextResponse.json({ ok: true })
})

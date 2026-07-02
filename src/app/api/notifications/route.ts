import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (_req, ctx) => {
  const { userId } = ctx

  const notifications = await prisma.notification.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    take:    50,
  })
  return NextResponse.json(notifications)
})

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (req, ctx) => {
  const { userId } = ctx

  const scope = new URL(req.url).searchParams.get("scope")
  if (scope !== "MEMBRE" && scope !== "GESTION") {
    return NextResponse.json({ error: "scope must be MEMBRE or GESTION" }, { status: 422 })
  }

  const notifications = await prisma.notification.findMany({
    where:   { userId, scope },
    orderBy: { createdAt: "desc" },
    take:    50,
  })
  return NextResponse.json(notifications)
})

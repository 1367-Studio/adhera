import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

export const POST = withAdminAuth(async (req, ctx) => {
  const { userId } = ctx

  const scope = new URL(req.url).searchParams.get("scope")
  if (scope !== "MEMBRE" && scope !== "GESTION") {
    return NextResponse.json({ error: "scope must be MEMBRE or GESTION" }, { status: 422 })
  }

  await prisma.notification.updateMany({
    where: { userId, read: false, scope },
    data:  { read: true },
  })
  return NextResponse.json({ ok: true })
})

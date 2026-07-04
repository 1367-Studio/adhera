import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const typeId = searchParams.get("typeId") ?? undefined

  const count = await prisma.membre.count({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      phone:         { not: null },
      ...(typeId ? { typeId } : {}),
    },
  })

  return NextResponse.json({ count })
}, { module: "sms" })

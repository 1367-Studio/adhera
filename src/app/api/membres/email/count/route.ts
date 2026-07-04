import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

export const GET = withAdminAuth(async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const typeId = searchParams.get("typeId") ?? undefined

  const count = await prisma.membre.count({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      email:         { not: null },
      ...(typeId ? { typeId } : {}),
    },
  })

  return NextResponse.json({ count })
})

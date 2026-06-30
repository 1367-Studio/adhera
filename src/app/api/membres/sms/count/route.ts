import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

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
}

import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  const count = await prisma.membre.count({
    where: {
      associationId: ctx.associationId,
      deletedAt:     null,
      status:        "ACTIF",
      email:         { not: null },
    },
  })

  return NextResponse.json({ count })
}

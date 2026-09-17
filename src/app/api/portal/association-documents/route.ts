import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const documents = await prisma.associationDocument.findMany({
    where:   { associationId, deletedAt: null, visibleToMembers: true },
    orderBy: { title: "asc" },
    select:  { id: true, title: true, updatedAt: true },
  })

  return NextResponse.json(documents)
}, { requireMembre: false })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const { associationId } = ctx

  // A logged-in member must never see less than a stranger does, so a document published
  // publicly is listed here too even when visibleToMembers was left off.
  const documents = await prisma.associationDocument.findMany({
    where:   { associationId, deletedAt: null, OR: [{ visibleToMembers: true }, { visibleToPublic: true }] },
    orderBy: { title: "asc" },
    select:  { id: true, title: true, fileUrl: true, fileName: true, updatedAt: true },
  })

  return NextResponse.json(documents)
}, { requireMembre: false })

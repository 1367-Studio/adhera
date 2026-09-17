import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  // Missing, deleted, hidden and another association's documents all answer the same 404 —
  // a member must not be able to tell a hidden document exists by probing ids.
  const document = await prisma.associationDocument.findFirst({
    where:  { id, associationId, deletedAt: null, visibleToMembers: true },
    select: { id: true, title: true, content: true, updatedAt: true },
  })

  if (!document) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  return NextResponse.json(document)
}, { requireMembre: false })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth(async (_req, ctx) => {
  const taches = await prisma.tache.findMany({
    where:   { associationId: ctx.associationId, assignees: { some: { membreId: ctx.membreId! } } },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    include: {
      categorie:   { select: { id: true, nom: true } },
      assignees:   { include: { membre: { select: { id: true, firstName: true, lastName: true } } } },
      completedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  return NextResponse.json(taches)
}, { module: "taches" })

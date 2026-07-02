import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

export const GET = withPortalAuth<Params>(async (_req, ctx, { id }) => {
  const now = new Date()
  const sondage = await prisma.sondage.findFirst({
    where: {
      id,
      associationId: ctx.associationId,
      status:        "ACTIF",
      OR: [{ deadline: null }, { deadline: { gte: now } }],
    },
    include: {
      questions: { orderBy: { order: "asc" } },
      reponses:  { where: { membreId: ctx.membreId! }, select: { id: true } },
    },
  })

  if (!sondage) return NextResponse.json({ error: "Sondage introuvable ou fermé" }, { status: 404 })

  // Check membership in recipients for SELECTED mode
  if (sondage.recipientMode === "SELECTED") {
    const recipient = await prisma.sondageRecipient.findUnique({
      where: { sondageId_membreId: { sondageId: id, membreId: ctx.membreId! } },
    })
    if (!recipient) return NextResponse.json({ error: "Non autorisé" }, { status: 403 })
  }

  return NextResponse.json({
    id:          sondage.id,
    title:       sondage.title,
    description: sondage.description,
    anonymous:   sondage.anonymous,
    deadline:    sondage.deadline,
    questions:   sondage.questions,
    repondu:     sondage.reponses.length > 0,
  })
})

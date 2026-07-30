import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { startOfTodayUTC } from "@/lib/date-boundaries"

export const GET = withPortalAuth(async (_req, ctx) => {
  // Active sondages for this association that this member is a recipient of
  const sondages = await prisma.sondage.findMany({
    where: {
      associationId: ctx.associationId,
      status:        "ACTIF",
      AND: [
        { OR: [{ deadline: null }, { deadline: { gte: startOfTodayUTC() } }] },
        { OR: [
          { recipientMode: "ALL" },
          { recipientMode: "SELECTED", recipients: { some: { membreId: ctx.membreId! } } },
        ]},
      ],
    },
    include: {
      _count:    { select: { questions: true } },
      reponses:  { where: { membreId: ctx.membreId! }, select: { id: true, submittedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(
    sondages.map(s => ({
      id:          s.id,
      title:       s.title,
      description: s.description,
      deadline:    s.deadline,
      anonymous:   s.anonymous,
      questionsCount: s._count.questions,
      repondu:     s.reponses.length > 0,
      submittedAt: s.reponses[0]?.submittedAt ?? null,
    })),
  )
})

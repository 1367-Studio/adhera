import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: { questions: { orderBy: { order: "asc" } } },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const reponses = await prisma.sondageReponse.findMany({
    where:   { sondageId: id },
    orderBy: { submittedAt: "asc" },
    include: {
      membre: { select: { firstName: true, lastName: true } },
      items:  { select: { questionId: true, value: true } },
    },
  })

  return NextResponse.json({
    anonymous: sondage.anonymous,
    questions: sondage.questions.map(q => ({
      id:        q.id,
      label:     q.label,
      type:      q.type,
      order:     q.order,
      condition: q.condition as { questionId: string; operator: string; value: string } | null,
    })),
    reponses: reponses.map((r, i) => ({
      id:            r.id,
      index:         i + 1,
      membre:        sondage.anonymous ? null : r.membre,
      memberDeleted: !sondage.anonymous && r.membre === null,
      submittedAt:   r.submittedAt.toISOString(),
      items:         r.items,
    })),
  })
})

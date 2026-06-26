import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      questions: { orderBy: { order: "asc" } },
      _count:    { select: { reponses: true } },
    },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  // All response items grouped by question
  const items = await prisma.sondageReponseItem.findMany({
    where:   { reponse: { sondageId: id } },
    select:  { questionId: true, value: true },
  })

  const totalReponses = sondage._count.reponses

  const questionResults = sondage.questions.map(q => {
    const qItems = items.filter(i => i.questionId === q.id)

    if (q.type === "TEXT_SHORT" || q.type === "TEXT_LONG") {
      return {
        questionId: q.id,
        type:       q.type,
        label:      q.label,
        count:      qItems.length,
        answers:    qItems.map(i => i.value).filter(Boolean),
      }
    }

    if (q.type === "RATING") {
      const values = qItems.map(i => parseInt(i.value ?? "0", 10)).filter(v => v >= 1 && v <= 5)
      const avg    = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
      const dist   = [1, 2, 3, 4, 5].map(star => ({
        star,
        count: values.filter(v => v === star).length,
      }))
      return { questionId: q.id, type: q.type, label: q.label, count: values.length, avg, distribution: dist }
    }

    if (q.type === "YES_NO") {
      const oui = qItems.filter(i => i.value === "OUI").length
      const non = qItems.filter(i => i.value === "NON").length
      return {
        questionId: q.id,
        type:       q.type,
        label:      q.label,
        count:      qItems.length,
        choices:    [
          { label: "Oui", count: oui },
          { label: "Non", count: non },
        ],
      }
    }

    // SINGLE_CHOICE or MULTIPLE_CHOICE
    const optionList = (q.options as string[] | null) ?? []
    const counts: Record<string, number> = {}
    for (const opt of optionList) counts[opt] = 0

    for (const item of qItems) {
      try {
        const vals: string[] = q.type === "MULTIPLE_CHOICE"
          ? JSON.parse(item.value ?? "[]")
          : [item.value ?? ""]
        for (const v of vals) {
          if (v in counts) counts[v]++
          else counts[v] = 1
        }
      } catch { /* skip malformed */ }
    }

    return {
      questionId: q.id,
      type:       q.type,
      label:      q.label,
      count:      qItems.length,
      choices:    Object.entries(counts).map(([label, count]) => ({ label, count })),
    }
  })

  return NextResponse.json({ totalReponses, questions: questionResults })
}

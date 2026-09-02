import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

async function findOwnParticipation(evenementId: string, membreId: string) {
  return prisma.participation.findFirst({
    where:  { evenementId, membreId },
    select: { id: true, present: true, avis: { select: { id: true } } },
  })
}

export const GET = withPortalAuth<Params>(async (_req, ctx, { id: evenementId }) => {
  const participation = await findOwnParticipation(evenementId, ctx.membreId!)
  if (!participation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    eligible:         participation.present,
    alreadySubmitted: !!participation.avis,
  })
})

const bodySchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
})

export const POST = withPortalAuth<Params>(async (req, ctx, { id: evenementId }) => {
  const participation = await findOwnParticipation(evenementId, ctx.membreId!)
  if (!participation) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!participation.present)
    return NextResponse.json({ error: "Seuls les participants présents peuvent laisser un avis." }, { status: 422 })
  if (participation.avis)
    return NextResponse.json({ error: "Vous avez déjà laissé un avis." }, { status: 409 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { rating, comment } = parsed.data

  try {
    await prisma.evenementAvis.create({
      data: {
        evenementId,
        participationId: participation.id,
        rating,
        comment: comment || null,
      },
    })
  } catch {
    return NextResponse.json({ error: "Vous avez déjà laissé un avis." }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
})

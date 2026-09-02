import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Public, no-login page for leaving a post-event review — reached via the unguessable
// reviewToken emailed after the event (see src/inngest/event-review-request.ts), same
// pattern as src/app/api/public/cancel-ticket/[token]/route.ts's cancelToken. Only
// participants marked present can review, and only once per participation (enforced both
// here and by the unique constraint on EvenementAvis.participationId).

async function findByToken(token: string) {
  return prisma.participation.findUnique({
    where:  { reviewToken: token },
    include: {
      evenement: { select: { title: true, date: true } },
      avis:      { select: { id: true } },
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`review-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const participation = await findByToken(token)
  if (!participation) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })

  return NextResponse.json({
    eventTitle:      participation.evenement.title,
    eventDate:       participation.evenement.date,
    firstName:       participation.firstName,
    eligible:        participation.present,
    alreadySubmitted: !!participation.avis,
  })
}

const bodySchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`review-submit:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const participation = await findByToken(token)
  if (!participation) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
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
        evenementId:     participation.evenementId,
        participationId: participation.id,
        rating,
        comment: comment || null,
      },
    })
  } catch {
    // Unique constraint on participationId — a second submit racing the first.
    return NextResponse.json({ error: "Vous avez déjà laissé un avis." }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}

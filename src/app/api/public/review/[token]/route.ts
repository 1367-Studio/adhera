import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { notifyEventReviewSubmitted } from "@/lib/evenement-notify"
import { reportError } from "@/lib/monitoring"

// Public, no-login page for leaving a post-event review — reached via the unguessable
// reviewToken emailed after the event (see src/inngest/event-review-request.ts), same
// pattern as src/app/api/public/cancel-ticket/[token]/route.ts's cancelToken. Only
// participants marked present can review, and only once per participation (enforced both
// here and by the unique constraint on EvenementAvis.participationId).

async function findByToken(token: string) {
  return prisma.participation.findUnique({
    where:  { reviewToken: token },
    include: {
      evenement: { select: { title: true, date: true, associationId: true, adminNotificationEmail: true } },
      avis:      { select: { id: true, publicationAgreedAt: true, anonymous: true } },
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
    // Only meaningful once alreadySubmitted — lets the page offer to change/revoke the
    // publication choice later instead of it being a one-time, unrevisable decision.
    publicationAgreed: !!participation.avis?.publicationAgreedAt,
    anonymous:         participation.avis?.anonymous ?? false,
  })
}

const bodySchema = z.object({
  rating:            z.number().int().min(1).max(5),
  comment:           z.string().trim().max(2000).optional(),
  publicationAgreed: z.boolean(),
  anonymous:         z.boolean().optional(),
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
  const { rating, comment, publicationAgreed, anonymous } = parsed.data

  try {
    await prisma.evenementAvis.create({
      data: {
        evenementId:     participation.evenementId,
        participationId: participation.id,
        rating,
        comment: comment || null,
        // Consentement posé server-side au moment de la soumission — jamais repris tel quel
        // du client pour l'horodatage, même logique que cguvAgreedAt ailleurs.
        publicationAgreedAt: publicationAgreed ? new Date() : null,
        anonymous:           publicationAgreed ? !!anonymous : false,
      },
    })
  } catch {
    // Unique constraint on participationId — a second submit racing the first.
    return NextResponse.json({ error: "Vous avez déjà laissé un avis." }, { status: 409 })
  }

  notifyEventReviewSubmitted({
    associationId:          participation.evenement.associationId,
    evenementId:            participation.evenementId,
    eventTitle:             participation.evenement.title,
    eventDate:              participation.evenement.date,
    reviewerName:           `${participation.firstName} ${participation.lastName}`,
    rating,
    comment,
    adminNotificationEmail: participation.evenement.adminNotificationEmail,
  }).catch(error => reportError(error, { area: "public", action: "public.evenement.review.notify-admins", extra: { associationId: participation.evenement.associationId, evenementId: participation.evenementId, participationId: participation.id } }))

  return NextResponse.json({ ok: true })
}

const consentBodySchema = z.object({
  publicationAgreed: z.boolean(),
  anonymous:         z.boolean().optional(),
})

// Lets a participant revisit their own review link later to change or withdraw their
// publication consent — the one-time POST above has no other way back once submitted. Never
// touches rating/comment, only the publication choice. Revoking (publicationAgreed: false)
// also force-clears featuredOnSite: the review must stop being eligible immediately (not just
// wait for an admin to notice), and re-consenting later must never silently re-publish it
// without the admin choosing to feature it again — same "no automatic publication" rule as the
// original submission.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`review-update:${requestIp(req)}`, 20, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const participation = await findByToken(token)
  if (!participation) return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  if (!participation.avis)
    return NextResponse.json({ error: "Aucun avis à mettre à jour." }, { status: 422 })

  const parsed = consentBodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { publicationAgreed, anonymous } = parsed.data

  await prisma.evenementAvis.update({
    where: { id: participation.avis.id },
    data:  {
      publicationAgreedAt: publicationAgreed ? new Date() : null,
      anonymous:           publicationAgreed ? !!anonymous : false,
      ...(publicationAgreed ? {} : { featuredOnSite: false }),
    },
  })

  return NextResponse.json({ ok: true })
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { stripe } from "@/lib/stripe"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

type SessionUser = { id?: string; associationId?: string | null }

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const guard = await guardModule(u.associationId, "evenements")
  if (guard) return guard

  const { id: evenementId } = await params

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId: u.associationId },
    select: { title: true, date: true, price: true, associationId: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Impossible d'annuler un billet pour un événement déjà passé." }, { status: 422 })

  const participation = await prisma.participation.findUnique({
    where: { membreId_evenementId: { membreId: membre.id, evenementId } },
  })
  if (!participation?.ticketPaidAt)
    return NextResponse.json({ error: "Aucun billet payé pour cet événement." }, { status: 404 })
  if (!participation.stripeSessionId)
    return NextResponse.json({ error: "Ce billet a été réglé hors ligne — contactez l'association pour l'annuler." }, { status: 422 })

  const checkoutSession = await stripe.checkout.sessions.retrieve(participation.stripeSessionId)
  const paymentIntentId = typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id
  if (!paymentIntentId)
    return NextResponse.json({ error: "Paiement introuvable côté Stripe." }, { status: 422 })

  await stripe.refunds.create({
    payment_intent:         paymentIntentId,
    reverse_transfer:       true,
    refund_application_fee: true,
  })

  await prisma.$transaction([
    prisma.participation.update({
      where: { id: participation.id },
      data:  { ticketPaidAt: null, stripeSessionId: null, paidQuantity: null, rsvp: null, quantity: 1 },
    }),
    prisma.income.deleteMany({
      where: {
        associationId: evenement.associationId,
        memberId:      membre.id,
        description:   `Billet (Stripe) — ${evenement.title}`,
      },
    }),
  ])

  await writeActivityLog({
    associationId: u.associationId,
    actorId:       u.id,
    action:        "TICKET_REFUNDED",
    entity:        "Participation",
    entityId:      participation.id,
    label:         evenement.title,
  })

  return NextResponse.json({ ok: true })
}

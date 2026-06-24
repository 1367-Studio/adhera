import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"

type SessionUser = { id?: string; associationId?: string | null }

const PLATFORM_FEE = 0.015

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id: evenementId } = await params

  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId: u.associationId },
    include: { association: { select: { stripeConnectId: true, name: true, slug: true } } },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })
  if (evenement.price == null || Number(evenement.price) === 0)
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })
  if (!evenement.association.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const connectAccount = await stripe.accounts.retrieve(evenement.association.stripeConnectId)
  if (!connectAccount.charges_enabled)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId!, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existing = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId } },
    select: { ticketPaidAt: true },
  })
  if (existing?.ticketPaidAt)
    return NextResponse.json({ error: "Billet déjà acheté" }, { status: 422 })

  if (evenement.capacity != null) {
    const paidCount = await prisma.participation.count({
      where: { evenementId, ticketPaidAt: { not: null } },
    })
    if (paidCount >= evenement.capacity)
      return NextResponse.json({ error: "Événement complet" }, { status: 422 })
  }

  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId } },
    create: { membreId: membre.id, evenementId },
    update: {},
    select: { id: true },
  })

  const amountCents    = Math.round(Number(evenement.price) * 100)
  const applicationFee = Math.round(amountCents * PLATFORM_FEE)
  const slug           = evenement.association.slug

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: `${evenement.association.name} — ${evenement.title}` },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: evenement.association.stripeConnectId },
      metadata:               { participationId: participation.id, associationId: u.associationId },
    },
    metadata:    { participationId: participation.id },
    success_url: `${APP_URL}/portal/${slug}/evenements?ticket=success&eid=${evenementId}`,
    cancel_url:  `${APP_URL}/portal/${slug}/evenements?ticket=cancelled`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })

  return NextResponse.json({ url: checkoutSession.url })
}

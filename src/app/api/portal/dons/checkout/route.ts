import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { APP_URL } from "@/lib/env"

type SessionUser = { id?: string; associationId?: string | null }

const PLATFORM_FEE = 0.015

const schema = z.object({
  amount:    z.number().positive().max(100000),
  message:   z.string().trim().max(500).optional(),
  anonymous: z.boolean().optional().default(false),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { amount, message, anonymous } = parsed.data

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId!, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, address: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId! },
    select: { id: true, name: true, slug: true, stripeConnectId: true, modules: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.dons) return NextResponse.json({ error: "Module dons désactivé" }, { status: 403 })

  if (!assoc.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible" }, { status: 400 })

  const don = await prisma.don.create({
    data: {
      associationId: assoc.id,
      membreId:      membre.id,
      firstName:     membre.firstName,
      lastName:      membre.lastName,
      email:         membre.email ?? "",
      address:       membre.address ?? null,
      amount,
      message:       message || null,
      anonymous,
    },
  })

  const amountCents    = Math.round(amount * 100)
  const applicationFee = Math.round(amountCents * PLATFORM_FEE)

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: `Don à ${assoc.name}` },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: assoc.stripeConnectId },
      metadata:               { donId: don.id, associationId: assoc.id },
    },
    metadata:    { donId: don.id },
    success_url: `${APP_URL}/portal/${assoc.slug}/dons?payment=success`,
    cancel_url:  `${APP_URL}/portal/${assoc.slug}/dons?payment=cancelled`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

  await prisma.don.update({
    where: { id: don.id },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url })
}

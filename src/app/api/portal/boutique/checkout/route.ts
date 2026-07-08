import { NextResponse } from "next/server"
import { z } from "zod"
import { stripe, connectAccountChargesEnabled, PLATFORM_FEE } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const itemSchema = z.object({
  produitId:  z.string(),
  varianteId: z.string(),
  quantity:   z.number().int().min(1).max(99),
})

const schema = z.object({
  items: z.array(itemSchema).min(1).max(50),
  note:  z.string().trim().max(500).optional().nullable(),
})

export const POST = withPortalAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { id: true, name: true, slug: true, stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  if (!assoc.stripeConnectId)
    return NextResponse.json({ error: "Le paiement en ligne n'est pas encore configuré par votre association" }, { status: 400 })
  if (!(await connectAccountChargesEnabled(assoc.stripeConnectId)))
    return NextResponse.json({ error: "Le paiement en ligne n'est pas encore configuré par votre association" }, { status: 400 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const { items, note } = parsed.data

  // Create commande + decrement stock atomically
  const commande = await prisma.$transaction(async tx => {
    let totalAmount = 0
    const lineItems: Array<{
      produitId: string; varianteId: string; quantity: number; unitPrice: number
    }> = []

    for (const item of items) {
      const variante = await tx.boutiqueVariante.findFirst({
        where:   { id: item.varianteId, produitId: item.produitId },
        include: { produit: { select: { associationId: true, status: true } } },
      })

      if (!variante || variante.produit.associationId !== ctx.associationId)
        throw new Error("Variante introuvable")
      if (variante.produit.status !== "ACTIVE")
        throw new Error("Produit non disponible")
      if (variante.stock < item.quantity)
        throw new Error(`Stock insuffisant pour "${variante.label}" (disponible: ${variante.stock})`)

      await tx.boutiqueVariante.update({
        where: { id: variante.id },
        data:  { stock: { decrement: item.quantity } },
      })

      totalAmount += variante.price * item.quantity
      lineItems.push({ produitId: item.produitId, varianteId: item.varianteId, quantity: item.quantity, unitPrice: variante.price })
    }

    return tx.boutiqueCommande.create({
      data: {
        associationId: ctx.associationId,
        membreId:      ctx.membreId!,
        status:        "PENDING",
        paymentMethod: "STRIPE",
        totalAmount,
        note:          note ?? null,
        items:         { create: lineItems },
      },
    })
  }, { isolationLevel: "Serializable" })

  // Fetch items with names for Stripe line_items
  const commandeItems = await prisma.boutiqueCommandeItem.findMany({
    where:   { commandeId: commande.id },
    include: {
      produit:  { select: { name: true } },
      variante: { select: { label: true } },
    },
  })

  const applicationFee = Math.round(commande.totalAmount * PLATFORM_FEE)

  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: commandeItems.map(item => ({
        price_data: {
          currency:     "eur",
          unit_amount:  item.unitPrice,
          product_data: { name: `${item.produit.name} – ${item.variante.label}` },
        },
        quantity: item.quantity,
      })),
      payment_intent_data: {
        application_fee_amount: applicationFee,
        transfer_data:          { destination: assoc.stripeConnectId! },
        metadata:               { commandeId: commande.id, associationId: assoc.id },
      },
      metadata:    { commandeId: commande.id },
      success_url: `${APP_URL}/portal/${assoc.slug}/boutique/commandes?payment=success`,
      cancel_url:  `${APP_URL}/portal/${assoc.slug}/boutique/panier`,
      // Stock is reserved (decremented) as soon as the commande is created, below, and
      // only released back on `checkout.session.expired` — shorten Stripe's default 24h
      // window (the minimum Stripe allows) so an abandoned cart doesn't lock stock all day.
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    })
  } catch {
    // Stripe failed — cancel commande and restore stock
    await prisma.$transaction([
      prisma.boutiqueCommande.update({ where: { id: commande.id }, data: { status: "CANCELLED" } }),
      ...commandeItems.map(item =>
        prisma.boutiqueVariante.update({
          where: { id: item.varianteId },
          data:  { stock: { increment: item.quantity } },
        })
      ),
    ])
    return NextResponse.json({ error: "Erreur lors de la création du paiement Stripe" }, { status: 500 })
  }

  await prisma.boutiqueCommande.update({
    where: { id: commande.id },
    data:  { stripePaymentIntentId: checkoutSession.id },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${(commande.totalAmount / 100).toFixed(2)} € (Stripe)`,
  })

  return NextResponse.json({ url: checkoutSession.url })
}, { module: "boutique" })

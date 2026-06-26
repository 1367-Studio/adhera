import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { APP_URL } from "@/lib/env"
import { writeActivityLog } from "@/lib/activity-log"

const PLATFORM_FEE = 0.015

type SessionUser = { id?: string; associationId?: string | null }

const itemSchema = z.object({
  produitId:  z.string(),
  varianteId: z.string(),
  quantity:   z.number().int().min(1).max(99),
})

const schema = z.object({
  items: z.array(itemSchema).min(1).max(50),
  note:  z.string().trim().max(500).optional().nullable(),
})

async function getMembre(userId: string, associationId: string) {
  return prisma.membre.findFirst({
    where:  { userId, associationId, deletedAt: null },
    select: { id: true },
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId },
    select: { id: true, name: true, slug: true, stripeConnectId: true, modules: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  if (!assoc.stripeConnectId)
    return NextResponse.json({ error: "Le paiement en ligne n'est pas encore configuré par votre association" }, { status: 400 })

  const membre = await getMembre(u.id!, u.associationId)
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

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

      if (!variante || variante.produit.associationId !== u.associationId)
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
        associationId: u.associationId!,
        membreId:      membre.id,
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
    associationId: u.associationId,
    actorId:       u.id!,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${(commande.totalAmount / 100).toFixed(2)} € (Stripe)`,
  })

  return NextResponse.json({ url: checkoutSession.url })
}

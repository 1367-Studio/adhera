import { NextResponse } from "next/server"
import { z } from "zod"
import { stripe, connectAccountChargesEnabled } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { InsufficientStockError } from "@/lib/boutique/insufficient-stock-error"
import { deliveryFieldsSchema, validateDeliveryFields } from "@/lib/boutique/delivery-schema"
import { resolveShippingCost, ShippingUnavailableError } from "@/lib/boutique/resolve-shipping-cost"
import { randomBytes } from "crypto"

const itemSchema = z.object({
  produitId:  z.string(),
  varianteId: z.string(),
  quantity:   z.number().int().min(1).max(99),
})

const schema = z.object({
  items:     z.array(itemSchema).min(1).max(50),
  firstName: z.string().trim().min(1).max(100),
  lastName:  z.string().trim().min(1).max(100),
  // Requis pour permettre un éventuel remboursement Stripe côté association — pas
  // seulement pour la confirmation de commande.
  email:     z.string().email().max(200),
  phone:     z.string().trim().max(30).optional(),
  note:      z.string().trim().max(500).optional().nullable(),
  // Honeypot — jamais rempli par un vrai visiteur (masqué hors écran), même convention
  // que les formulaires publics de dons/adhésion/inscription.
  website:   z.string().optional().or(z.literal("")),
  ...deliveryFieldsSchema,
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!(await rateLimit(`boutique-checkout:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const deliveryError = validateDeliveryFields(parsed.data)
  if (deliveryError) return NextResponse.json({ error: deliveryError }, { status: 422 })

  // Pretend success without touching the DB or Stripe — same anti-bot convention as the
  // donation/event registration routes.
  if (parsed.data.website) return NextResponse.json({ url: `${APP_URL}/${slug}/boutique` })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  if (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))
    return NextResponse.json({ error: "Le paiement en ligne n'est pas encore configuré par cette association" }, { status: 400 })

  const { items, firstName, lastName, email, phone, note, deliveryMethod, shippingAddress, shippingCity, shippingPostalCode, shippingCountry, shippingOptionCode } = parsed.data
  const guestName = `${firstName} ${lastName}`.trim()

  let shippingCost = 0
  let shippingCarrierLabel: string | null = null
  if (deliveryMethod === "DELIVERY") {
    try {
      const resolved = await resolveShippingCost({
        associationId:  assoc.id,
        items:          items.map(i => ({ varianteId: i.varianteId, quantity: i.quantity })),
        destCountry:    shippingCountry!,
        destPostalCode: shippingPostalCode!,
        optionCode:     shippingOptionCode!,
      })
      shippingCost = resolved.costCents
      shippingCarrierLabel = resolved.carrierLabel
    } catch (err) {
      if (err instanceof ShippingUnavailableError)
        return NextResponse.json({ error: err.message }, { status: 422 })
      throw err
    }
  }

  // Reserve stock at creation time, same reasoning as the portal boutique checkout
  // (src/app/api/portal/boutique/checkout/route.ts): this is a direct purchase, not a
  // product tacked onto another checkout, so it gets the safer "reserve now, release on
  // expiry" strategy rather than the soft-check-then-decrement-at-webhook one used by the
  // membership-form/event-registration product add-ons.
  let commande
  try {
    commande = await prisma.$transaction(async tx => {
      let totalAmount = 0
      const lineItems: Array<{
        produitId: string; varianteId: string; quantity: number; unitPrice: number; categoryId: string | null
      }> = []

      for (const item of items) {
        const variante = await tx.boutiqueVariante.findFirst({
          where:   { id: item.varianteId, produitId: item.produitId },
          include: { produit: { select: { associationId: true, status: true, categoryId: true } } },
        })

        if (!variante || variante.produit.associationId !== assoc.id)
          throw new Error("Variante introuvable")
        if (variante.produit.status !== "ACTIVE")
          throw new Error("Produit non disponible")
        if (variante.stock < item.quantity)
          throw new InsufficientStockError(variante.id, variante.label, variante.stock)

        await tx.boutiqueVariante.update({
          where: { id: variante.id },
          data:  { stock: { decrement: item.quantity } },
        })

        totalAmount += variante.price * item.quantity
        lineItems.push({ produitId: item.produitId, varianteId: item.varianteId, quantity: item.quantity, unitPrice: variante.price, categoryId: variante.produit.categoryId })
      }

      return tx.boutiqueCommande.create({
        data: {
          associationId: assoc.id,
          guestName,
          guestEmail:    email,
          trackingToken: randomBytes(20).toString("hex"),
          status:        "PENDING",
          paymentMethod: "STRIPE",
          source:        "STOREFRONT",
          totalAmount:   totalAmount + shippingCost,
          note:          note || (phone ? `Tél: ${phone}` : null),
          deliveryMethod,
          shippingAddress:      deliveryMethod === "DELIVERY" ? shippingAddress    : null,
          shippingCity:         deliveryMethod === "DELIVERY" ? shippingCity       : null,
          shippingPostalCode:   deliveryMethod === "DELIVERY" ? shippingPostalCode : null,
          shippingCountry:      deliveryMethod === "DELIVERY" ? shippingCountry    : null,
          shippingCost,
          shippingCarrierLabel,
          items:         { create: lineItems },
        },
      })
    }, { isolationLevel: "Serializable" })
  } catch (err) {
    if (err instanceof InsufficientStockError)
      return NextResponse.json({ error: err.message, insufficientItems: [{ varianteId: err.varianteId, available: err.available }] }, { status: 422 })
    const message = err instanceof Error ? err.message : "Erreur lors de la création de la commande"
    return NextResponse.json({ error: message }, { status: 422 })
  }

  const commandeItems = await prisma.boutiqueCommandeItem.findMany({
    where:   { commandeId: commande.id },
    include: {
      produit:  { select: { name: true } },
      variante: { select: { label: true } },
    },
  })

  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        ...commandeItems.map(item => ({
          price_data: {
            currency:     "eur",
            unit_amount:  item.unitPrice,
            product_data: { name: `${item.produit.name} – ${item.variante.label}` },
          },
          quantity: item.quantity,
        })),
        ...(commande.shippingCost > 0 ? [{
          price_data: {
            currency:     "eur",
            unit_amount:  commande.shippingCost,
            product_data: { name: commande.shippingCarrierLabel ?? "Livraison" },
          },
          quantity: 1,
        }] : []),
      ],
      customer_email: email,
      payment_intent_data: {
        transfer_data: { destination: assoc.stripeConnectId },
        metadata:      { commandeId: commande.id, associationId: assoc.id },
      },
      metadata:    { commandeId: commande.id },
      success_url: `${APP_URL}/${slug}/boutique/panier?payment=success&token=${commande.trackingToken}`,
      cancel_url:  `${APP_URL}/${slug}/boutique/panier?payment=cancelled`,
      // Stock is already reserved (decremented) above and only released back on
      // `checkout.session.expired` — shorten Stripe's default 24h window so an abandoned
      // cart doesn't lock stock all day.
      expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
    })
  } catch (err) {
    // Stripe failed — cancel commande and restore stock
    console.error(`[boutique-storefront-checkout] Stripe session creation failed for commande ${commande.id}:`, err)
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
    associationId: assoc.id,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${guestName} — ${(commande.totalAmount / 100).toFixed(2)} € (Stripe, boutique publique)`,
  })

  return NextResponse.json({ url: checkoutSession.url })
}

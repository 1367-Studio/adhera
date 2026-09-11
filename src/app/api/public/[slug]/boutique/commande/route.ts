import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmail } from "@/lib/mail"
import { boutiqueNewOrderAdminEmail, boutiquePendingOrderEmail } from "@/lib/email"
import { pusherServer } from "@/lib/pusher-server"
import { APP_URL } from "@/lib/env"
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
  email:     z.string().email().max(200),
  phone:     z.string().trim().max(30).optional(),
  note:      z.string().trim().max(500).optional().nullable(),
  website:   z.string().optional().or(z.literal("")),
  ...deliveryFieldsSchema,
})

// Pay-on-pickup: no Stripe session at all — the commande is created straight in PENDING,
// same as the portal's own MANUAL flow (src/app/api/portal/boutique/commandes/route.ts),
// and an admin later marks it PAID in person (PATCH /api/boutique/commandes/[id]) once the
// buyer actually hands over cash/cheque/card. Stock is decremented immediately (no Stripe
// hold to expire later, unlike the checkout/route.ts sibling), matching the portal MANUAL
// behavior exactly.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  if (!(await rateLimit(`boutique-commande-manual:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  if (parsed.data.website) return NextResponse.json({ ok: true })

  const deliveryError = validateDeliveryFields(parsed.data)
  if (deliveryError) return NextResponse.json({ error: deliveryError }, { status: 422 })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.boutique) return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  const { items, firstName, lastName, email, phone, note, deliveryMethod, shippingAddress, shippingCity, shippingPostalCode, shippingCountry, shippingOptionCode, shippingOptionCostCents } = parsed.data
  const guestName = `${firstName} ${lastName}`.trim()

  let shippingCost = 0
  let shippingCarrierLabel: string | null = null
  if (deliveryMethod === "DELIVERY") {
    try {
      const resolved = await resolveShippingCost({
        associationId:     assoc.id,
        items:             items.map(i => ({ varianteId: i.varianteId, quantity: i.quantity })),
        destCountry:       shippingCountry!,
        destPostalCode:    shippingPostalCode!,
        optionCode:        shippingOptionCode!,
        expectedCostCents: shippingOptionCostCents!,
      })
      shippingCost = resolved.costCents
      shippingCarrierLabel = resolved.carrierLabel
    } catch (err) {
      if (err instanceof ShippingUnavailableError)
        return NextResponse.json({ error: err.message }, { status: 422 })
      throw err
    }
  }

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
          paymentMethod: "MANUAL",
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
        include: {
          items: { include: { produit: { select: { name: true } }, variante: { select: { label: true } } } },
        },
      })
    }, { isolationLevel: "Serializable" })
  } catch (err) {
    if (err instanceof InsufficientStockError)
      return NextResponse.json({ error: err.message, insufficientItems: [{ varianteId: err.varianteId, available: err.available }] }, { status: 422 })
    const message = err instanceof Error ? err.message : "Erreur lors de la création de la commande"
    return NextResponse.json({ error: message }, { status: 422 })
  }

  await writeActivityLog({
    associationId: assoc.id,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${guestName} — ${(commande.totalAmount / 100).toFixed(2)} € (paiement à la remise, boutique publique)`,
  })

  // Confirms the order was recorded (not that it's paid) and gives the guest a way to check
  // status later without an account — the admin-facing alert below is separate and doesn't
  // reach the buyer.
  sendEmail(boutiquePendingOrderEmail({
    firstName:       firstName.trim(),
    email,
    associationName: assoc.name,
    totalAmount:     commande.totalAmount,
    items: commande.items.map(i => ({
      name:      `${i.produit.name} – ${i.variante.label}`,
      quantity:  i.quantity,
      unitPrice: i.unitPrice,
    })),
    trackingUrl: `${APP_URL}/${slug}/boutique/pedido/${commande.trackingToken}`,
  }), { associationId: assoc.id, source: "TRANSACTION", sourceId: commande.id })
    .catch(err => console.error(`[boutique-pending-order] failed to email guest ${email} for commande ${commande.id}:`, err))

  // Same reasoning as the portal MANUAL flow: this commits the visitor to picking up and
  // paying in person, so admins should know right away — not just once it's encaissé.
  const admins = await prisma.user.findMany({
    where:  { associationId: assoc.id, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"] }, active: true },
    select: { id: true, email: true },
  })
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        title:  "Nouvelle commande boutique",
        body:   `${guestName} a passé une commande de ${(commande.totalAmount / 100).toFixed(2)} € (paiement à la remise)`,
        link:   `/dashboard/boutique?tab=commandes&commandeId=${commande.id}`,
        scope:  "GESTION",
      })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${assoc.id}`, "new-notification", {}).catch(() => {})

    const dashboardUrl = `${APP_URL}/dashboard/boutique`
    for (const admin of admins) {
      if (!admin.email) continue
      sendEmail(boutiqueNewOrderAdminEmail({
        email:           admin.email,
        associationName: assoc.name,
        buyerLabel:      guestName,
        totalAmount:     commande.totalAmount,
        dashboardUrl,
      }), { associationId: assoc.id, source: "BOUTIQUE_ADMIN_ALERT", sourceId: commande.id })
        .catch(err => console.error(`[boutique-admin-alert] failed to email admin ${admin.email} for commande ${commande.id}:`, err))
    }
  }

  return NextResponse.json(commande, { status: 201 })
}

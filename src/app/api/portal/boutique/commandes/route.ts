import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const itemSchema = z.object({
  produitId:  z.string(),
  varianteId: z.string(),
  quantity:   z.number().int().min(1).max(99),
})

const checkoutSchema = z.object({
  items:         z.array(itemSchema).min(1).max(50),
  paymentMethod: z.enum(["STRIPE", "MANUAL"]).default("MANUAL"),
  note:          z.string().trim().max(500).optional().nullable(),
})

export const GET = withPortalAuth(async (_req, ctx) => {
  const commandes = await prisma.boutiqueCommande.findMany({
    where:   { associationId: ctx.associationId, membreId: ctx.membreId! },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true } },
        },
      },
    },
  })

  return NextResponse.json(commandes)
}, { module: "boutique" })

export const POST = withPortalAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { items, paymentMethod, note } = parsed.data

  const commande = await prisma.$transaction(async tx => {
    let totalAmount = 0
    const lineItems: Array<{ produitId: string; varianteId: string; quantity: number; unitPrice: number }> = []

    for (const item of items) {
      const variante = await tx.boutiqueVariante.findFirst({
        where:   { id: item.varianteId, produitId: item.produitId },
        include: { produit: { select: { associationId: true, status: true } } },
      })

      if (!variante || variante.produit.associationId !== ctx.associationId)
        throw new Error(`Variante introuvable: ${item.varianteId}`)
      if (variante.produit.status !== "ACTIVE")
        throw new Error(`Produit non disponible`)
      if (variante.stock < item.quantity)
        throw new Error(`Stock insuffisant pour "${variante.label}" (disponible: ${variante.stock})`)

      await tx.boutiqueVariante.update({
        where: { id: variante.id },
        data:  { stock: { decrement: item.quantity } },
      })

      totalAmount += variante.price * item.quantity
      lineItems.push({
        produitId:  item.produitId,
        varianteId: item.varianteId,
        quantity:   item.quantity,
        unitPrice:  variante.price,
      })
    }

    return tx.boutiqueCommande.create({
      data: {
        associationId: ctx.associationId,
        membreId:      ctx.membreId!,
        status:        "PENDING",
        paymentMethod,
        totalAmount,
        note: note ?? null,
        items: { create: lineItems },
      },
      include: {
        items: {
          include: {
            produit:  { select: { name: true, imageUrl: true } },
            variante: { select: { label: true } },
          },
        },
      },
    })
  }, { isolationLevel: "Serializable" })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${(commande.totalAmount / 100).toFixed(2)} €`,
  })

  return NextResponse.json(commande, { status: 201 })
}, { module: "boutique" })

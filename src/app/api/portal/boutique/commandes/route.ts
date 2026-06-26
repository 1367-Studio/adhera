import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { writeActivityLog } from "@/lib/activity-log"

type SessionUser = { id?: string; associationId?: string | null }

async function getMembre(userId: string, associationId: string) {
  return prisma.membre.findFirst({
    where:  { userId, associationId, deletedAt: null },
    select: { id: true },
  })
}

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

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const membre = await getMembre(u.id!, u.associationId)
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const commandes = await prisma.boutiqueCommande.findMany({
    where:   { associationId: u.associationId, membreId: membre.id },
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
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId },
    select: { modules: true },
  })
  const modules = parseModules(assoc?.modules)
  if (!modules.boutique)
    return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  const membre = await getMembre(u.id!, u.associationId)
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

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

      if (!variante || variante.produit.associationId !== u.associationId)
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
        associationId: u.associationId!,
        membreId:      membre.id,
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
    associationId: u.associationId,
    actorId:       u.id!,
    action:        "BOUTIQUE_COMMANDE_CREATED",
    entity:        "BoutiqueCommande",
    entityId:      commande.id,
    label:         `${(commande.totalAmount / 100).toFixed(2)} €`,
  })

  return NextResponse.json(commande, { status: 201 })
}

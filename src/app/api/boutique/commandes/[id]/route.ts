import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const updateSchema = z.object({
  status: z.enum(["PENDING", "PAID", "CANCELLED"]),
  note:   z.string().trim().max(500).optional().nullable(),
})

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const commande = await prisma.boutiqueCommande.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      membre: { select: { firstName: true, lastName: true, email: true } },
      items:  {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true, price: true } },
        },
      },
    },
  })
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json(commande)
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const commande = await prisma.boutiqueCommande.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, status: true, totalAmount: true },
  })
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { status, note } = parsed.data

  if (commande.status === "CANCELLED")
    return NextResponse.json({ error: "Impossible de modifier une commande annulée" }, { status: 422 })
  if (commande.status === status)
    return NextResponse.json({ error: "Statut déjà appliqué" }, { status: 422 })

  await prisma.$transaction(async tx => {
    await tx.boutiqueCommande.update({
      where: { id },
      data:  { status, ...(note !== undefined ? { note: note ?? null } : {}) },
    })

    // On cancel: restore stock
    if (status === "CANCELLED" && commande.status !== "CANCELLED") {
      const items = await tx.boutiqueCommandeItem.findMany({ where: { commandeId: id } })
      for (const item of items) {
        await tx.boutiqueVariante.update({
          where: { id: item.varianteId },
          data:  { stock: { increment: item.quantity } },
        })
      }
    }

    // On PAID: create tresorerie entry
    if (status === "PAID" && commande.status !== "PAID") {
      const assocId = ctx.associationId
      await tx.tresorerieEntry.create({
        data: {
          associationId: assocId,
          type:          "ENTREE",
          amount:        commande.totalAmount / 100,
          description:   "Vente boutique",
          date:          new Date(),
          category:      "Boutique",
        },
      })
    }
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_UPDATED",
    entity:        "BoutiqueCommande",
    entityId:      id,
    label:         `Statut → ${status}`,
  })

  const updated = await prisma.boutiqueCommande.findUnique({
    where:   { id },
    include: {
      membre: { select: { firstName: true, lastName: true, email: true } },
      items:  {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true, price: true } },
        },
      },
    },
  })
  return NextResponse.json(updated)
}

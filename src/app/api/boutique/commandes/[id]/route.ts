import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

const updateSchema = z.object({
  status: z.enum(["PENDING", "PAID", "CANCELLED"]),
  note:   z.string().trim().max(500).optional().nullable(),
  items:  z.array(z.object({ id: z.string(), quantity: z.number().int().min(0) })).optional(),
})

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

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
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const commande = await prisma.boutiqueCommande.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, status: true, totalAmount: true, paymentMethod: true, membreId: true, membre: { select: { firstName: true, lastName: true } } },
  })
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { status, note, items: itemUpdates } = parsed.data

  if (commande.status === "CANCELLED")
    return NextResponse.json({ error: "Impossible de modifier une commande annulée" }, { status: 422 })
  if (commande.status === "PAID")
    return NextResponse.json({ error: "Impossible de modifier une commande déjà payée" }, { status: 422 })
  if (commande.status === status)
    return NextResponse.json({ error: "Statut déjà appliqué" }, { status: 422 })

  try {
    await prisma.$transaction(async tx => {
      let paidAmount = commande.totalAmount

      // Adjust item quantities for manual payments being marked as PAID
      if (itemUpdates?.length && status === "PAID" && commande.paymentMethod === "MANUAL") {
        const currentItems = await tx.boutiqueCommandeItem.findMany({
          where:  { commandeId: id },
          select: { id: true, quantity: true, unitPrice: true, varianteId: true },
        })

        let newTotal = 0
        for (const upd of itemUpdates) {
          const cur = currentItems.find(i => i.id === upd.id)
          if (!cur) continue
          const newQty = Math.min(Math.max(0, upd.quantity), cur.quantity)
          if (newQty < cur.quantity) {
            await tx.boutiqueVariante.update({
              where: { id: cur.varianteId },
              data:  { stock: { increment: cur.quantity - newQty } },
            })
            await tx.boutiqueCommandeItem.update({
              where: { id: upd.id },
              data:  { quantity: newQty },
            })
          }
          newTotal += cur.unitPrice * newQty
        }

        if (newTotal === 0)
          throw new Error("Le montant encaissé ne peut pas être nul — annulez la commande si aucun article n'a été retiré")

        paidAmount = newTotal
        await tx.boutiqueCommande.update({ where: { id }, data: { totalAmount: newTotal } })
      }

      await tx.boutiqueCommande.update({
        where: { id },
        data:  { status, ...(note !== undefined ? { note: note ?? null } : {}) },
      })

      // On cancel: restore current stock quantities
      if (status === "CANCELLED") {
        const currentItems = await tx.boutiqueCommandeItem.findMany({ where: { commandeId: id } })
        for (const item of currentItems) {
          if (item.quantity > 0) {
            await tx.boutiqueVariante.update({
              where: { id: item.varianteId },
              data:  { stock: { increment: item.quantity } },
            })
          }
        }
      }

      if (status === "PAID") {
        await tx.income.create({
          data: {
            associationId: ctx.associationId,
            memberId:      commande.membreId ?? undefined,
            amount:        paidAmount / 100,
            description:   commande.membre ? `Vente boutique — ${commande.membre.firstName} ${commande.membre.lastName}` : "Vente boutique",
            source:        "MANUAL",
            status:        "PAID",
            date:          new Date(),
          },
        })
      }
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 422 })
  }

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
})

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

type SessionUser = { id?: string; associationId?: string | null }
type Params = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  status: z.literal("CANCELLED").optional(),
  items:  z.array(z.object({ id: z.string(), quantity: z.number().int().min(0) })).optional(),
})

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const guard = await guardModule(u.associationId, "boutique")
  if (guard) return guard

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const commande = await prisma.boutiqueCommande.findFirst({
    where:   { id, associationId: u.associationId, membreId: membre.id },
    include: {
      items: {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true, price: true } },
        },
      },
    },
  })
  if (!commande) return NextResponse.json({ error: "Commande introuvable" }, { status: 404 })

  return NextResponse.json(commande)
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const guard = await guardModule(u.associationId, "boutique")
  if (guard) return guard

  const membre = await prisma.membre.findFirst({
    where:  { userId: u.id!, associationId: u.associationId, deletedAt: null },
    select: { id: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const commande = await prisma.boutiqueCommande.findFirst({
    where:  { id, associationId: u.associationId, membreId: membre.id },
    select: { id: true, status: true, paymentMethod: true },
  })
  if (!commande) return NextResponse.json({ error: "Commande introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { status, items: itemUpdates } = parsed.data
  if (!status && !itemUpdates?.length) {
    return NextResponse.json({ error: "Aucune modification fournie" }, { status: 422 })
  }

  if (commande.status !== "PENDING") {
    return NextResponse.json({ error: "Cette commande ne peut plus être modifiée." }, { status: 422 })
  }

  // A Stripe checkout session (if any) was created for the original total — editing quantities
  // here would desync it from what's actually charged. Only cancellation is safe for STRIPE orders.
  if (itemUpdates?.length && commande.paymentMethod === "STRIPE") {
    return NextResponse.json({ error: "Une commande payée par carte ne peut être qu'annulée, pas modifiée." }, { status: 422 })
  }

  try {
    await prisma.$transaction(async tx => {
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
        await tx.boutiqueCommande.update({ where: { id }, data: { status: "CANCELLED" } })
        return
      }

      const currentItems = await tx.boutiqueCommandeItem.findMany({
        where:  { commandeId: id },
        select: { id: true, quantity: true, unitPrice: true, varianteId: true },
      })

      let newTotal = 0
      for (const cur of currentItems) {
        const upd    = itemUpdates!.find(u => u.id === cur.id)
        const newQty = upd ? Math.min(Math.max(0, upd.quantity), cur.quantity) : cur.quantity
        if (newQty < cur.quantity) {
          await tx.boutiqueVariante.update({
            where: { id: cur.varianteId },
            data:  { stock: { increment: cur.quantity - newQty } },
          })
          await tx.boutiqueCommandeItem.update({ where: { id: cur.id }, data: { quantity: newQty } })
        }
        newTotal += cur.unitPrice * newQty
      }

      if (newTotal === 0) {
        throw new Error("Le montant ne peut pas être nul — annulez la commande si vous ne voulez plus aucun article.")
      }

      await tx.boutiqueCommande.update({ where: { id }, data: { totalAmount: newTotal } })
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur" }, { status: 422 })
  }

  await writeActivityLog({
    associationId: u.associationId,
    actorId:       u.id!,
    action:        status === "CANCELLED" ? "BOUTIQUE_COMMANDE_CANCELLED" : "BOUTIQUE_COMMANDE_UPDATED",
    entity:        "BoutiqueCommande",
    entityId:      id,
    label:         status === "CANCELLED" ? "Annulée par le membre" : "Modifiée par le membre",
  })

  const updated = await prisma.boutiqueCommande.findUnique({
    where:   { id },
    include: {
      items: {
        include: {
          produit:  { select: { name: true, imageUrl: true } },
          variante: { select: { label: true, price: true } },
        },
      },
    },
  })
  return NextResponse.json(updated)
}

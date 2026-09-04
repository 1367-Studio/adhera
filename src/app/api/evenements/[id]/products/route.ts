import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { guardModule } from "@/lib/auth/require-module"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Mirroir exact de src/app/api/membership-forms/[id]/products/route.ts — voir ce fichier
// pour le raisonnement détaillé (pointeur pur, jamais référencé par un BoutiqueCommandeItem,
// donc supprimable/recréable librement à chaque sauvegarde).
const MAX_PRODUCTS = 10

const productSchema = z.object({
  varianteId: z.string().min(1),
  order:      z.number().int().min(0),
})

const productsSchema = z.array(productSchema).max(MAX_PRODUCTS)

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const evenement = await prisma.evenement.findFirst({ where: { id, associationId: ctx.associationId }, select: { id: true } })
  if (!evenement) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const products = await prisma.evenementProduct.findMany({
    where:   { evenementId: id },
    orderBy: { order: "asc" },
    include: {
      variante: {
        select: {
          id: true, label: true, price: true, stock: true,
          produit: { select: { id: true, name: true, status: true } },
        },
      },
    },
  })
  return NextResponse.json(products)
}, { roles: MANAGERS, module: "evenements" })

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  // Vendre des produits depuis un événement n'a de sens que si le module Boutique lui-même
  // est actif — même raisonnement que membership-forms/[id]/products/route.ts.
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!evenement) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = productsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const varianteIds = parsed.data.map(p => p.varianteId)
  if (new Set(varianteIds).size !== varianteIds.length)
    return NextResponse.json({ error: "Produit en double" }, { status: 422 })

  if (varianteIds.length) {
    const variantes = await prisma.boutiqueVariante.findMany({
      where:  { id: { in: varianteIds } },
      select: { id: true, produit: { select: { associationId: true, status: true } } },
    })
    const byId = new Map(variantes.map(v => [v.id, v]))
    for (const varianteId of varianteIds) {
      const v = byId.get(varianteId)
      if (!v || v.produit.associationId !== ctx.associationId || v.produit.status !== "ACTIVE")
        return NextResponse.json({ error: "Produit invalide" }, { status: 422 })
    }
  }

  const products = await prisma.$transaction(async tx => {
    await tx.evenementProduct.deleteMany({ where: { evenementId: id } })
    if (parsed.data.length) {
      await tx.evenementProduct.createMany({
        data: parsed.data.map(p => ({ evenementId: id, varianteId: p.varianteId, order: p.order })),
      })
    }
    return tx.evenementProduct.findMany({
      where:   { evenementId: id },
      orderBy: { order: "asc" },
      include: {
        variante: {
          select: {
            id: true, label: true, price: true, stock: true,
            produit: { select: { id: true, name: true, status: true } },
          },
        },
      },
    })
  })

  return NextResponse.json(products)
}, { roles: MANAGERS, module: "evenements" })

import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Un même produit ne peut apparaître qu'une fois par formulaire (voir aussi la contrainte
// @@unique([formId, varianteId]) côté schema) et le nombre de lignes reste faible — ce sont
// des articles d'upsell curés par l'admin, pas un catalogue entier à parcourir ici.
const MAX_PRODUCTS = 10

const productSchema = z.object({
  varianteId: z.string().min(1),
  order:      z.number().int().min(0),
})

const productsSchema = z.array(productSchema).max(MAX_PRODUCTS)

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({ where: { id, associationId: ctx.associationId }, select: { id: true } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const products = await prisma.membershipFormProduct.findMany({
    where:   { formId: id },
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
}, { module: "cotisations" })

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  // Vendre des produits depuis l'adhésion n'a de sens que si le module Boutique lui-même est
  // actif — sans ça, un admin pourrait configurer des offres qu'aucune page publique ne pourra
  // jamais honorer (et dont le stock ne serait plus visible nulle part ailleurs).
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const form = await prisma.membershipForm.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = productsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const varianteIds = parsed.data.map(p => p.varianteId)
  if (new Set(varianteIds).size !== varianteIds.length)
    return NextResponse.json({ error: "Produit en double" }, { status: 422 })

  if (varianteIds.length) {
    const variantes = await prisma.boutiqueVariante.findMany({
      where:   { id: { in: varianteIds } },
      select:  { id: true, produit: { select: { associationId: true, status: true } } },
    })
    const byId = new Map(variantes.map(v => [v.id, v]))
    for (const varianteId of varianteIds) {
      const v = byId.get(varianteId)
      // Le même contrôle couvre le cross-tenant (variante inexistante ou d'une autre
      // association) et le statut — un produit DRAFT/ARCHIVED ne peut pas être proposé, même
      // s'il l'était déjà avant d'être archivé (la ligne existante n'est alors plus
      // sauvegardable telle quelle, elle doit être retirée du payload pour être conservée).
      if (!v || v.produit.associationId !== ctx.associationId || v.produit.status !== "ACTIVE")
        return NextResponse.json({ error: "Produit invalide" }, { status: 422 })
    }
  }

  // Pas de garde-fou "déjà utilisé" contrairement à tiers/route.ts : une ligne
  // MembershipFormProduct est un pur pointeur d'offre, jamais référencé par un
  // BoutiqueCommandeItem (celui-ci pointe directement sur varianteId) — supprimer/recréer
  // librement à chaque sauvegarde ne perd donc aucun historique.
  const products = await prisma.$transaction(async tx => {
    await tx.membershipFormProduct.deleteMany({ where: { formId: id } })
    if (parsed.data.length) {
      await tx.membershipFormProduct.createMany({
        data: parsed.data.map(p => ({ formId: id, varianteId: p.varianteId, order: p.order })),
      })
    }
    return tx.membershipFormProduct.findMany({
      where:   { formId: id },
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
}, { module: "cotisations" })

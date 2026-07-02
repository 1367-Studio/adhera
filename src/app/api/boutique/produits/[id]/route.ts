import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const varianteSchema = z.object({
  id:    z.string().optional(),
  label: z.string().trim().min(1).max(100),
  price: z.number().int().min(0),
  stock: z.number().int().min(0).default(0),
})

const updateSchema = z.object({
  name:        z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  imageUrl:    z.string().url().optional().nullable(),
  status:      z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  variantes:   z.array(varianteSchema).min(1).max(20).optional(),
})

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const produit = await prisma.boutiqueProduit.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      variantes:    { orderBy: { createdAt: "asc" } },
      _count:       { select: { commandeItems: true } },
    },
  })
  if (!produit) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  return NextResponse.json(produit)
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const produit = await prisma.boutiqueProduit.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, name: true },
  })
  if (!produit) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { name, description, imageUrl, status, variantes } = parsed.data

  const updated = await prisma.$transaction(async tx => {
    await tx.boutiqueProduit.update({
      where: { id },
      data: {
        ...(name        !== undefined ? { name }                           : {}),
        ...(description !== undefined ? { description: description ?? null } : {}),
        ...(imageUrl    !== undefined ? { imageUrl:    imageUrl    ?? null } : {}),
        ...(status      !== undefined ? { status }                         : {}),
      },
    })

    if (variantes) {
      const incomingIds = variantes.filter(v => v.id).map(v => v.id!)
      // Delete variantes not in incoming list (only if no commande items)
      await tx.boutiqueVariante.deleteMany({
        where: {
          produitId: id,
          id:        { notIn: incomingIds },
          commandeItems: { none: {} },
        },
      })

      for (const v of variantes) {
        if (v.id) {
          await tx.boutiqueVariante.update({
            where: { id: v.id },
            data:  { label: v.label, price: v.price, stock: v.stock },
          })
        } else {
          await tx.boutiqueVariante.create({
            data: { produitId: id, label: v.label, price: v.price, stock: v.stock },
          })
        }
      }
    }

    return tx.boutiqueProduit.findUnique({
      where:   { id },
      include: { variantes: { orderBy: { createdAt: "asc" } } },
    })
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_PRODUIT_UPDATED",
    entity:        "BoutiqueProduit",
    entityId:      id,
    label:         name ?? produit.name,
  })

  return NextResponse.json(updated)
})

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!["ADMIN", "PRESIDENT"].includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const produit = await prisma.boutiqueProduit.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, name: true },
  })
  if (!produit) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const commandeItemCount = await prisma.boutiqueCommandeItem.count({ where: { produitId: id } })
  if (commandeItemCount > 0) {
    return NextResponse.json(
      { error: `Impossible de supprimer : ce produit a été commandé ${commandeItemCount} fois. Archivez-le plutôt.` },
      { status: 409 },
    )
  }

  await prisma.boutiqueProduit.delete({ where: { id } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_PRODUIT_DELETED",
    entity:        "BoutiqueProduit",
    entityId:      id,
    label:         produit.name,
  })

  return NextResponse.json({ ok: true })
})

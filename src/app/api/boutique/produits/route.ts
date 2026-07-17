import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { assertIncomeCategory } from "@/lib/validate-finance-category"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const varianteSchema = z.object({
  label: z.string().trim().min(1).max(100),
  price: z.number().int().min(0),
  stock: z.number().int().min(0).default(0),
})

const createSchema = z.object({
  name:        z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  imageUrl:    z.string().url().optional().nullable(),
  status:      z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  categoryId:  z.string().optional().nullable(),
  variantes:   z.array(varianteSchema).min(1).max(20),
})

export const GET = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const produits = await prisma.boutiqueProduit.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { createdAt: "desc" },
    include: {
      variantes: { orderBy: { createdAt: "asc" } },
      _count:    { select: { commandeItems: true } },
    },
  })

  return NextResponse.json(produits)
})

export const POST = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { name, description, imageUrl, status, categoryId, variantes } = parsed.data

  if (categoryId) {
    const error = await assertIncomeCategory(ctx.associationId, categoryId)
    if (error) return NextResponse.json({ error }, { status: 422 })
  }

  const produit = await prisma.boutiqueProduit.create({
    data: {
      associationId: ctx.associationId,
      name,
      description:  description ?? null,
      imageUrl:     imageUrl    ?? null,
      status,
      categoryId:   categoryId ?? null,
      variantes: { create: variantes },
    },
    include: { variantes: true },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_PRODUIT_CREATED",
    entity:        "BoutiqueProduit",
    entityId:      produit.id,
    label:         produit.name,
  })

  return NextResponse.json(produit, { status: 201 })
})

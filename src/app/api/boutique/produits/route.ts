import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { writeActivityLog } from "@/lib/activity-log"

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
  variantes:   z.array(varianteSchema).min(1).max(20),
})

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const produits = await prisma.boutiqueProduit.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { createdAt: "desc" },
    include: {
      variantes: { orderBy: { createdAt: "asc" } },
      _count:    { select: { commandeItems: true } },
    },
  })

  return NextResponse.json(produits)
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { modules: true },
  })
  const modules = parseModules(assoc?.modules)
  if (!modules.boutique)
    return NextResponse.json({ error: "Module boutique désactivé" }, { status: 403 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { name, description, imageUrl, status, variantes } = parsed.data

  const produit = await prisma.boutiqueProduit.create({
    data: {
      associationId: ctx.associationId,
      name,
      description:  description ?? null,
      imageUrl:     imageUrl    ?? null,
      status,
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
}

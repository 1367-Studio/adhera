import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { tacheCategorieSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (_req, ctx) => {
  const categories = await prisma.tacheCategorie.findMany({
    where:   { associationId: ctx.associationId, archivedAt: null },
    orderBy: { nom: "asc" },
  })
  return NextResponse.json(categories)
}, { area: "taches" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = tacheCategorieSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const existing = await prisma.tacheCategorie.findFirst({ where: { associationId, nom: parsed.data.nom } })
  if (existing) {
    return existing.archivedAt
      ? NextResponse.json(await prisma.tacheCategorie.update({ where: { id: existing.id }, data: { archivedAt: null } }), { status: 200 })
      : NextResponse.json({ error: "Une catégorie avec ce nom existe déjà." }, { status: 409 })
  }

  const categorie = await prisma.tacheCategorie.create({ data: { associationId, nom: parsed.data.nom } })
  return NextResponse.json(categorie, { status: 201 })
}, { area: "taches", module: "taches" })

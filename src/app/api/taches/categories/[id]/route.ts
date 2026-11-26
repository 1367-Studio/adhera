import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { tacheCategorieSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const existing = await prisma.tacheCategorie.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = tacheCategorieSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const categorie = await prisma.tacheCategorie.update({ where: { id }, data: { nom: parsed.data.nom } })
  return NextResponse.json(categorie)
}, { area: "taches", module: "taches" })

// Archive, jamais de suppression dure — une catégorie déjà utilisée par une tâche doit
// continuer à se résoudre dans l'historique (même convention que FinanceCategory).
export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const existing = await prisma.tacheCategorie.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  await prisma.tacheCategorie.update({ where: { id }, data: { archivedAt: new Date() } })
  return new NextResponse(null, { status: 204 })
}, { area: "taches", module: "taches" })

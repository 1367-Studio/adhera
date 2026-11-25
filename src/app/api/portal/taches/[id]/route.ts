import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

// À faire/En cours seulement — passer à Terminée vit dans .../complete/route.ts (partagé avec
// le côté staff). Pas de suppression côté membre (voir critères de validation FORM-118).
const schema = z.object({ status: z.enum(["A_FAIRE", "EN_COURS"]) })

export const PATCH = withPortalAuth<{ id: string }>(async (req, ctx, { id }) => {
  const existing = await prisma.tache.findFirst({
    where: { id, associationId: ctx.associationId, assignees: { some: { membreId: ctx.membreId! } } },
  })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (existing.status === "TERMINEE") return NextResponse.json({ error: "Tâche déjà terminée" }, { status: 409 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const tache = await prisma.tache.update({ where: { id }, data: { status: parsed.data.status } })
  return NextResponse.json(tache)
}, { module: "taches" })

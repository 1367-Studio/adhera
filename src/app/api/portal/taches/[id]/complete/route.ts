import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { completeTache } from "@/lib/tache-complete"

// Revalide systématiquement l'assignation côté serveur (pas seulement le filtrage
// d'affichage) pour bloquer l'accès direct par URL à une tâche non assignée ou d'une autre
// association (voir critères de validation FORM-118).
export const POST = withPortalAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const existing = await prisma.tache.findFirst({
    where: { id, associationId: ctx.associationId, assignees: { some: { membreId: ctx.membreId! } } },
  })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (existing.status === "TERMINEE") return NextResponse.json(existing)

  const tache = await completeTache(id, ctx.membreId)
  return NextResponse.json(tache)
}, { module: "taches" })

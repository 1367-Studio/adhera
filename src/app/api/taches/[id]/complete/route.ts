import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { completeTache, resolveActingMembreId } from "@/lib/tache-complete"

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.tache.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (existing.status === "TERMINEE") return NextResponse.json(existing)

  const actingMembreId = await resolveActingMembreId(userId, associationId)
  const tache = await completeTache(id, actingMembreId)

  await writeActivityLog({ associationId, actorId: userId, action: "TACHE_COMPLETED", entity: "Tache", entityId: id, label: tache.titre })
  return NextResponse.json(tache)
}, { area: "taches" })

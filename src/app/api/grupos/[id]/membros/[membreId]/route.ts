import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

export const DELETE = withAdminAuth<{ id: string; membreId: string }>(async (_req, ctx, { id, membreId }) => {
  const { associationId, userId } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })

  const link = await prisma.grupoMembre.findUnique({
    where: { grupoId_membreId: { grupoId: id, membreId } },
    include: { membre: { select: { firstName: true, lastName: true } } },
  })
  if (!link) return NextResponse.json({ error: "Ce membre n'est pas dans le groupe" }, { status: 404 })

  // Ne touche pas aux ChamadaPresenca déjà enregistrées (snapshot par membreId) — retirer un
  // membre du groupe ne doit jamais effacer son historique de présence passé.
  await prisma.grupoMembre.delete({ where: { grupoId_membreId: { grupoId: id, membreId } } })

  await writeActivityLog({
    associationId, actorId: userId, action: "GRUPO_MEMBRE_REMOVED", entity: "Grupo", entityId: id,
    label: `${link.membre.firstName} ${link.membre.lastName}`,
  })
  return NextResponse.json({ ok: true })
}, { area: "groupes", access: "edit", module: "groupes" })

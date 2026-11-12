import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

export const DELETE = withAdminAuth<{ id: string; userId: string }>(async (_req, ctx, { id, userId: targetUserId }) => {
  const { associationId, userId } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })

  const link = await prisma.grupoResponsavel.findUnique({
    where: { grupoId_userId: { grupoId: id, userId: targetUserId } },
    include: { user: { select: { name: true, email: true } } },
  })
  if (!link) return NextResponse.json({ error: "Ce responsable n'est pas lié à ce groupe" }, { status: 404 })

  await prisma.grupoResponsavel.delete({ where: { grupoId_userId: { grupoId: id, userId: targetUserId } } })

  await writeActivityLog({
    associationId, actorId: userId, action: "GRUPO_RESPONSAVEL_REMOVED", entity: "Grupo", entityId: id,
    label: link.user.name ?? link.user.email,
  })
  return NextResponse.json({ ok: true })
}, { area: "groupes", access: "edit", module: "groupes" })

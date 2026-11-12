import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { canReadGrupo } from "@/lib/grupos/access"
import { grupoUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({
    where: { id, associationId },
    include: {
      membros:      { include: { membre: { select: { id: true, firstName: true, lastName: true, status: true } } } },
      responsaveis: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count:       { select: { chamadas: true } },
    },
  })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })

  if (!(await canReadGrupo(permissions, userId, grupo.id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  return NextResponse.json(grupo)
}, { module: "groupes" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = grupoUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const { nome, descricao, archived } = parsed.data

  const grupo = await prisma.grupo.update({
    where: { id },
    data: {
      ...(nome !== undefined ? { nome } : {}),
      ...(descricao !== undefined ? { descricao: descricao || null } : {}),
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    },
  })

  await writeActivityLog({
    associationId, actorId: userId, entity: "Grupo", entityId: grupo.id, label: grupo.nome,
    action: archived !== undefined ? (archived ? "GRUPO_ARCHIVED" : "GRUPO_UNARCHIVED") : "GRUPO_UPDATED",
  })
  return NextResponse.json(grupo)
}, { area: "groupes", access: "edit", module: "groupes" })

import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { STAFF_ROLES } from "@/lib/permissions"
import { grupoResponsavelSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = grupoResponsavelSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const staffUser = await prisma.user.findFirst({
    where: { id: parsed.data.userId, associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null },
  })
  if (!staffUser) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 })

  const existing = await prisma.grupoResponsavel.findUnique({
    where: { grupoId_userId: { grupoId: id, userId: staffUser.id } },
  })
  if (existing) return NextResponse.json({ error: "Déjà responsable de ce groupe" }, { status: 409 })

  const link = await prisma.grupoResponsavel.create({
    data: { grupoId: id, userId: staffUser.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "GRUPO_RESPONSAVEL_ADDED", entity: "Grupo", entityId: id,
    label: staffUser.name ?? staffUser.email,
  })
  return NextResponse.json(link, { status: 201 })
}, { area: "groupes", access: "edit", module: "groupes" })

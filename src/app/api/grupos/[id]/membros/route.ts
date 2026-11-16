import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { grupoMembroSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = grupoMembroSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const membre = await prisma.membre.findFirst({ where: { id: parsed.data.membreId, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existing = await prisma.grupoMembre.findUnique({
    where: { grupoId_membreId: { grupoId: id, membreId: membre.id } },
  })
  if (existing) return NextResponse.json({ error: "Ce membre est déjà dans le groupe" }, { status: 409 })

  const link = await prisma.grupoMembre.create({
    data: { grupoId: id, membreId: membre.id },
    include: { membre: { select: { id: true, firstName: true, lastName: true, status: true } } },
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "GRUPO_MEMBRE_ADDED", entity: "Grupo", entityId: id,
    label: `${membre.firstName} ${membre.lastName}`,
  })
  return NextResponse.json(link, { status: 201 })
}, { area: "groupes", access: "edit", module: "groupes" })

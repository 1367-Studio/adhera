import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { canReadGrupo, canActOnGrupoChamada } from "@/lib/grupos/access"
import { chamadaUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

export const GET = withAdminAuth<{ id: string; chamadaId: string }>(async (_req, ctx, { id, chamadaId }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })
  if (!(await canReadGrupo(permissions, userId, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const sessao = await prisma.chamadaSessao.findFirst({
    where:   { id: chamadaId, grupoId: id },
    include: { presencas: { include: { membre: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { membre: { lastName: "asc" } } } },
  })
  if (!sessao) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 })

  return NextResponse.json({ ...sessao, grupoNome: grupo.nome })
}, { module: "groupes" })

export const PATCH = withAdminAuth<{ id: string; chamadaId: string }>(async (req, ctx, { id, chamadaId }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })
  if (!(await canActOnGrupoChamada(permissions, userId, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  // Même règle qu'à la création : un groupe archivé ne doit plus être modifié, seulement
  // consulté.
  if (grupo.archivedAt) return NextResponse.json({ error: "Ce groupe est archivé" }, { status: 409 })

  const sessao = await prisma.chamadaSessao.findFirst({ where: { id: chamadaId, grupoId: id } })
  if (!sessao) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = chamadaUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  // Concurrence optimiste : si l'appel a été sauvegardé par quelqu'un d'autre depuis que cette
  // vue a chargé ses données, on refuse plutôt que d'écraser ses changements avec notre état
  // local périmé (celui-ci n'envoie que l'ensemble complet des présences qu'il connaît).
  if (parsed.data.expectedUpdatedAt && parsed.data.expectedUpdatedAt !== sessao.updatedAt.toISOString()) {
    return NextResponse.json({ error: "Cet appel a été modifié entre-temps par quelqu'un d'autre. Rechargez la page pour voir les derniers changements." }, { status: 409 })
  }

  const { data, horario, atividade, entries } = parsed.data

  const updated = await prisma.$transaction(async tx => {
    await tx.chamadaSessao.update({
      where: { id: chamadaId },
      data: {
        ...(data !== undefined ? { data: new Date(data) } : {}),
        ...(horario !== undefined ? { horario: horario || null } : {}),
        ...(atividade !== undefined ? { atividade: atividade || null } : {}),
      },
    })

    if (entries?.length) {
      for (const entry of entries) {
        await tx.chamadaPresenca.upsert({
          where:  { chamadaSessaoId_membreId: { chamadaSessaoId: chamadaId, membreId: entry.membreId } },
          update: { status: entry.status },
          create: { chamadaSessaoId: chamadaId, membreId: entry.membreId, status: entry.status },
        })
      }
    }

    return tx.chamadaSessao.findUniqueOrThrow({
      where:   { id: chamadaId },
      include: { presencas: { include: { membre: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { membre: { lastName: "asc" } } } },
    })
  })

  await writeActivityLog({ associationId, actorId: userId, action: "CHAMADA_SAVED", entity: "Grupo", entityId: id, label: grupo.nome })
  return NextResponse.json(updated)
}, { module: "groupes" })

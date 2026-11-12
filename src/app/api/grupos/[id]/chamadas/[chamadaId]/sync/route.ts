import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { canActOnGrupoChamada } from "@/lib/grupos/access"
import { writeActivityLog } from "@/lib/activity-log"

// FORM-97 edge case : un membre ajouté au groupe APRÈS la création de l'appel du jour n'a pas
// de ChamadaPresenca (seuls les membres présents à la création en reçoivent une). Cette route
// ajoute une entrée NAO_INFORMADO pour chaque membre du groupe qui n'en a pas encore dans cet
// appel précis — jamais pour un appel déjà clos dans le temps, c'est à l'utilisateur de ne
// l'utiliser que sur l'appel du jour en cours.
export const POST = withAdminAuth<{ id: string; chamadaId: string }>(async (_req, ctx, { id, chamadaId }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })
  if (!(await canActOnGrupoChamada(permissions, userId, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (grupo.archivedAt) return NextResponse.json({ error: "Ce groupe est archivé" }, { status: 409 })

  const sessao = await prisma.chamadaSessao.findFirst({ where: { id: chamadaId, grupoId: id } })
  if (!sessao) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 })

  const [membros, existingPresencas] = await Promise.all([
    prisma.grupoMembre.findMany({ where: { grupoId: id }, select: { membreId: true } }),
    prisma.chamadaPresenca.findMany({ where: { chamadaSessaoId: chamadaId }, select: { membreId: true } }),
  ])
  const alreadyPresent = new Set(existingPresencas.map(p => p.membreId))
  const missing = membros.filter(m => !alreadyPresent.has(m.membreId))

  if (missing.length > 0) {
    await prisma.chamadaPresenca.createMany({
      data: missing.map(m => ({ chamadaSessaoId: chamadaId, membreId: m.membreId })),
    })
    await writeActivityLog({ associationId, actorId: userId, action: "CHAMADA_SYNCED", entity: "Grupo", entityId: id, label: grupo.nome, metadata: { added: missing.length } })
  }

  const updated = await prisma.chamadaSessao.findUniqueOrThrow({
    where:   { id: chamadaId },
    include: { presencas: { include: { membre: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { membre: { lastName: "asc" } } } },
  })

  return NextResponse.json({ ...updated, grupoNome: grupo.nome, addedCount: missing.length })
}, { module: "groupes" })

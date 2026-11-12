import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { canReadGrupo, canActOnGrupoChamada } from "@/lib/grupos/access"
import { chamadaCreateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })
  if (!(await canReadGrupo(permissions, userId, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const sessoes = await prisma.chamadaSessao.findMany({
    where:   { grupoId: id },
    orderBy: { data: "desc" },
    include: { presencas: { select: { status: true } } },
  })

  const withCounts = sessoes.map(sessao => {
    const counts = { PRESENTE: 0, AUSENTE: 0, AUSENCIA_JUSTIFICADA: 0, NAO_INFORMADO: 0 }
    for (const presenca of sessao.presencas) counts[presenca.status]++
    const { presencas: _presencas, ...rest } = sessao
    return { ...rest, counts }
  })

  return NextResponse.json(withCounts)
}, { module: "groupes" })

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })
  if (!(await canActOnGrupoChamada(permissions, userId, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  // Un groupe archivé ne doit plus accumuler d'activité — le bouton "Faire l'appel" est déjà
  // désactivé côté UI, cette vérification est la même règle côté serveur (la page détail reste
  // consultable pour l'historique, seule la création est bloquée).
  if (grupo.archivedAt) return NextResponse.json({ error: "Ce groupe est archivé" }, { status: 409 })

  const body   = await req.json().catch(() => null)
  const parsed = chamadaCreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })

  const data    = new Date(parsed.data.data)
  const horario = parsed.data.horario || null

  // Même groupe + même date + même horaire : on propose de rouvrir l'appel existant plutôt
  // que d'en créer un doublon (demande explicite du ticket). Pas de contrainte unique en
  // base, horario étant un texte libre optionnel. `data` est une date calendaire stockée en
  // minuit UTC (comme Exercice/Cotisation, voir src/lib/finance/exercice.ts) — les bornes du
  // jour doivent donc être calculées en UTC, pas en heure locale du serveur.
  const dayStart = new Date(data); dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd   = new Date(data); dayEnd.setUTCHours(23, 59, 59, 999)
  const existing = await prisma.chamadaSessao.findFirst({
    where: { grupoId: id, data: { gte: dayStart, lte: dayEnd }, horario },
  })
  if (existing) {
    return NextResponse.json({ error: "Un appel existe déjà pour ce créneau", chamadaId: existing.id }, { status: 409 })
  }

  const membros = await prisma.grupoMembre.findMany({ where: { grupoId: id }, select: { membreId: true } })

  const sessao = await prisma.chamadaSessao.create({
    data: {
      associationId,
      grupoId:   id,
      data,
      horario,
      atividade: parsed.data.atividade || null,
      presencas: { createMany: { data: membros.map(m => ({ membreId: m.membreId })) } },
    },
    include: { presencas: { include: { membre: { select: { id: true, firstName: true, lastName: true } } } } },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "CHAMADA_CREATED", entity: "Grupo", entityId: id, label: grupo.nome })
  return NextResponse.json(sessao, { status: 201 })
}, { module: "groupes" })

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { tacheSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { parseTacheFilters, buildTacheWhere } from "@/lib/tache-query"
import { notifyNewTacheAssignees } from "@/lib/tache-notifications"
import { reportError } from "@/lib/monitoring"

const include = {
  categorie: { select: { id: true, nom: true } },
  assignees: { include: { membre: { select: { id: true, firstName: true, lastName: true } } } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  reminders: true,
}
// nulls: "last" — une tâche "sans prazo" (FORM-118) doit rester visible, pas remonter en
// tête de liste juste parce que Postgres trie NULL en premier par défaut en ASC.
const orderBy = [{ dueDate: { sort: "asc" as const, nulls: "last" as const } }, { createdAt: "desc" as const }]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const filters = parseTacheFilters(searchParams)
  const where   = buildTacheWhere(associationId, filters)

  // Pas de `page` : liste complète (plafonnée) pour le calendrier/picker — même convention
  // que GET /api/cotisations.
  if (!searchParams.has("page")) {
    const data = await prisma.tache.findMany({ where, include, orderBy, take: 500 })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.tache.findMany({ where, include, orderBy, skip, take: limit }),
    prisma.tache.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { area: "taches" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = tacheSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { assigneeIds, reminders, dueDate, ...rest } = parsed.data

  let tache
  try {
    tache = await prisma.tache.create({
      data: {
        ...rest,
        associationId,
        createdByUserId: userId,
        dueDate:         dueDate ? new Date(dueDate) : null,
        assignees:       { createMany: { data: (assigneeIds ?? []).map(membreId => ({ membreId })) } },
        reminders:       { createMany: { data: reminders ?? [] } },
      },
      include,
    })
  } catch (error) {
    // Filet de sécurité derrière le refine zod (qui rejette déjà les doublons côté client) —
    // une contrainte unique violée ici ne peut normalement venir que d'un appel API externe.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Deux rappels identiques ne peuvent pas être ajoutés." }, { status: 409 })
    }
    throw error
  }

  await writeActivityLog({ associationId, actorId: userId, action: "TACHE_CREATED", entity: "Tache", entityId: tache.id, label: tache.titre })

  // Best-effort : un échec d'envoi ne doit pas faire échouer la création de la tâche —
  // même convention que writeActivityLog, qui avale déjà ses propres erreurs.
  try {
    await notifyNewTacheAssignees({ tacheId: tache.id, associationId, titre: tache.titre, dueDate: tache.dueDate, membreIds: assigneeIds ?? [] })
  } catch (error) {
    reportError(error, { area: "api", action: "tache.notify-assignees", extra: { tacheId: tache.id } })
  }

  return NextResponse.json(tache, { status: 201 })
}, { area: "taches", module: "taches" })

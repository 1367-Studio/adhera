import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { tacheUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { notifyNewTacheAssignees } from "@/lib/tache-notifications"
import { resolveActingMembreId } from "@/lib/tache-complete"
import { reportError } from "@/lib/monitoring"

const include = {
  categorie: { select: { id: true, nom: true } },
  assignees: { include: { membre: { select: { id: true, firstName: true, lastName: true } } } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  reminders: true,
}

async function resolve(id: string, associationId: string) {
  return prisma.tache.findFirst({ where: { id, associationId } })
}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const tache = await prisma.tache.findFirst({ where: { id, associationId: ctx.associationId }, include })
  if (!tache) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  return NextResponse.json(tache)
}, { area: "taches" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = tacheUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { assigneeIds, reminders, dueDate, status, ...rest } = parsed.data

  // Diff pris AVANT la transaction qui réécrit les assignés — sert à ne notifier que les
  // nouveaux (pas ceux déjà assignés), ce qui rend un PATCH qui ne touche pas les assignés
  // un no-op pour les notifications (pas de double envoi en cas de retraitement).
  const previousAssigneeIds = assigneeIds !== undefined
    ? (await prisma.tacheAssignee.findMany({ where: { tacheId: id }, select: { membreId: true } })).map(a => a.membreId)
    : []

  // Une échéance effacée (null/"") invalide tout rappel existant — un rappel "X jours
  // avant/après" n'a plus rien à calculer sans échéance. Résout l'échéance *finale* (celle
  // de ce PATCH si elle est touchée, sinon celle déjà en base) pour décider si les rappels
  // doivent être vidés même quand `reminders` n'est pas dans ce payload.
  const resolvedDueDate   = dueDate !== undefined ? (dueDate || null) : existing.dueDate
  const clearingDueDate   = dueDate !== undefined && !dueDate && existing.dueDate !== null
  const shouldClearReminders = resolvedDueDate === null

  const actingMembreId = status !== undefined ? await resolveActingMembreId(userId, associationId) : null

  let tache
  try {
    tache = await prisma.$transaction(async tx => {
      if (assigneeIds !== undefined) {
        await tx.tacheAssignee.deleteMany({ where: { tacheId: id } })
        if (assigneeIds.length > 0) {
          await tx.tacheAssignee.createMany({ data: assigneeIds.map(membreId => ({ tacheId: id, membreId })) })
        }
      }
      if (reminders !== undefined || (shouldClearReminders && clearingDueDate)) {
        await tx.tacheReminder.deleteMany({ where: { tacheId: id } })
        if (!shouldClearReminders && reminders && reminders.length > 0) {
          await tx.tacheReminder.createMany({ data: reminders.map(r => ({ ...r, tacheId: id })) })
        }
      }
      return tx.tache.update({
        where: { id },
        data: {
          ...rest,
          ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
          ...(status !== undefined ? (
            status === "TERMINEE"
              ? { status, completedAt: new Date(), completedByMembreId: actingMembreId }
              : { status, completedAt: null, completedByMembreId: null }
          ) : {}),
        },
        include,
      })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Deux rappels identiques ne peuvent pas être ajoutés." }, { status: 409 })
    }
    throw error
  }

  const activityAction = status === "TERMINEE" ? "TACHE_COMPLETED" : status !== undefined ? "TACHE_REOPENED" : "TACHE_UPDATED"
  await writeActivityLog({ associationId, actorId: userId, action: activityAction, entity: "Tache", entityId: id, label: tache.titre })

  if (assigneeIds !== undefined) {
    const newlyAdded = assigneeIds.filter(membreId => !previousAssigneeIds.includes(membreId))
    try {
      await notifyNewTacheAssignees({ tacheId: id, associationId, titre: tache.titre, dueDate: tache.dueDate, membreIds: newlyAdded })
    } catch (error) {
      reportError(error, { area: "api", action: "tache.notify-assignees", extra: { tacheId: id } })
    }
  }

  return NextResponse.json(tache)
}, { area: "taches", module: "taches" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  await prisma.tache.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "TACHE_DELETED", entity: "Tache", entityId: id, label: existing.titre })
  return new NextResponse(null, { status: 204 })
}, { area: "taches", module: "taches" })

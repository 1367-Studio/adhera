import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { actualiteUpdateSchema } from "@/lib/schemas"
import { pusherServer } from "@/lib/pusher-server"
import { stripHtml } from "@/lib/utils"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const include = {
  evenement:  { select: { id: true, title: true, date: true, location: true } },
  recipients: { select: { membreId: true } },
}

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.actualite.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const parsed = actualiteUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { evenementId, imageUrl, publishedAt, recipientMode, recipientIds, ...rest } = parsed.data

  const wasPublished = !!existing.publishedAt
  const nowPublished = publishedAt !== undefined ? publishedAt !== null : wasPublished

  // Sync recipients if mode/selection changed
  const syncingRecipients = recipientMode !== undefined || recipientIds !== undefined
  const newMode = recipientMode ?? existing.recipientMode

  if (!wasPublished && nowPublished && newMode === "SELECTED") {
    const recipientCount = syncingRecipients
      ? (recipientIds?.length ?? 0)
      : await prisma.actualiteRecipient.count({ where: { actualiteId: id } })
    if (recipientCount === 0) {
      return NextResponse.json({ error: "Sélectionnez au moins un destinataire avant de publier." }, { status: 422 })
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (syncingRecipients) {
      await tx.actualiteRecipient.deleteMany({ where: { actualiteId: id } })
      if (newMode === "SELECTED" && recipientIds?.length) {
        await tx.actualiteRecipient.createMany({
          data: recipientIds.map(membreId => ({ actualiteId: id, membreId })),
        })
      }
    }

    return tx.actualite.update({
      where: { id },
      data: {
        ...rest,
        ...(evenementId  !== undefined ? { evenementId:   evenementId  || null } : {}),
        ...(imageUrl     !== undefined ? { imageUrl:      imageUrl     || null } : {}),
        ...(recipientMode !== undefined ? { recipientMode }             : {}),
        ...(publishedAt  !== undefined
          ? { publishedAt: publishedAt ? new Date(publishedAt) : null }
          : {}),
      },
      include,
    })
  })

  // Notify on draft → published transition
  if (!wasPublished && nowPublished) {
    const pusherReady  = !!(process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET)
    const plainText    = stripHtml(updated.content)
    const notifBody    = plainText.slice(0, 120) + (plainText.length > 120 ? "…" : "")

    let userIds: string[]

    if (updated.recipientMode === "ALL") {
      const users = await prisma.user.findMany({
        where: { associationId, role: "MEMBRE", active: true },
        select: { id: true },
      })
      userIds = users.map(u => u.id)
    } else {
      const recipients = await prisma.actualiteRecipient.findMany({
        where:   { actualiteId: id },
        include: { membre: { select: { userId: true } } },
      })
      userIds = recipients.map(r => r.membre.userId).filter((uid): uid is string => !!uid)
    }

    await prisma.notification.createMany({
      data: userIds.map(uid => ({ userId: uid, title: updated.title, body: notifBody, link: "/portal/actualites" })),
      skipDuplicates: true,
    })
    if (pusherReady) {
      await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
    }
  }

  const changes: Record<string, { old: string | null; new: string | null }> = {}
  if (updated.title !== existing.title)
    changes.title = { old: existing.title, new: updated.title }
  if (updated.pinned !== existing.pinned)
    changes.pinned = { old: String(existing.pinned), new: String(updated.pinned) }
  if ((updated.publishedAt?.toISOString() ?? null) !== (existing.publishedAt?.toISOString() ?? null))
    changes.publishedAt = { old: existing.publishedAt?.toISOString() ?? null, new: updated.publishedAt?.toISOString() ?? null }
  if (updated.recipientMode !== existing.recipientMode)
    changes.recipientMode = { old: existing.recipientMode, new: updated.recipientMode }
  if (updated.content !== existing.content)
    changes.content = { old: null, new: null }

  await writeActivityLog({
    associationId, actorId: userId, action: "ACTUALITE_UPDATED", entity: "Actualite", entityId: id, label: updated.title,
    metadata: Object.keys(changes).length > 0 ? { changes } : undefined,
  })
  return NextResponse.json(updated)
}, { roles: MANAGERS, module: "actualites" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.actualite.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.actualite.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "ACTUALITE_DELETED", entity: "Actualite", entityId: id, label: existing.title })
  return NextResponse.json({ ok: true })
}, { roles: MANAGERS, module: "actualites" })

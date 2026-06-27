import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { actualiteUpdateSchema } from "@/lib/schemas"
import { pusherServer } from "@/lib/pusher-server"
import { stripHtml } from "@/lib/utils"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const include = {
  evenement:  { select: { id: true, title: true, date: true, location: true } },
  recipients: { select: { membreId: true } },
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "actualites")
  if (guard) return guard

  if (!MANAGERS.includes(role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
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

    await Promise.all(
      userIds.map(async (userId) => {
        const notif = await prisma.notification.create({
          data: { userId, title: updated.title, body: notifBody, link: "/portal/actualites" },
        })
        if (pusherReady) {
          await pusherServer.trigger(`user-${userId}`, "new-notification", { id: notif.id })
        }
      }),
    )
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
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "actualites")
  if (guard) return guard

  if (!MANAGERS.includes(role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.actualite.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.actualite.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "ACTUALITE_DELETED", entity: "Actualite", entityId: id, label: existing.title })
  return NextResponse.json({ ok: true })
}

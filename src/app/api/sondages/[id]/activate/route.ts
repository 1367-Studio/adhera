import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: {
      recipients:  { select: { membreId: true } },
      association: { select: { slug: true } },
    },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (sondage.status !== "BROUILLON")
    return NextResponse.json({ error: "Seul un brouillon peut être activé" }, { status: 400 })
  if (sondage.recipientMode === "SELECTED" && sondage.recipients.length === 0)
    return NextResponse.json({ error: "Ajoutez au moins un destinataire avant d'activer" }, { status: 400 })
  if (sondage.deadline && new Date(sondage.deadline) < new Date())
    return NextResponse.json({ error: "La date limite est déjà passée — modifiez-la avant d'activer" }, { status: 400 })

  await prisma.sondage.update({ where: { id }, data: { status: "ACTIF" } })

  // Determine recipients
  let membreIds: string[]
  if (sondage.recipientMode === "ALL") {
    const membres = await prisma.membre.findMany({
      where:  { associationId: ctx.associationId, deletedAt: null, status: "ACTIF" },
      select: { id: true },
    })
    membreIds = membres.map(m => m.id)
  } else {
    membreIds = sondage.recipients.map(r => r.membreId)
  }

  // Get userIds for those membres
  const membres = await prisma.membre.findMany({
    where:  { id: { in: membreIds }, userId: { not: null } },
    select: { userId: true },
  })

  if (membres.length) {
    await prisma.notification.createMany({
      data: membres
        .filter(m => m.userId)
        .map(m => ({
          userId: m.userId!,
          title:  `Nouveau sondage : ${sondage.title}`,
          body:   "Votre association vous invite à répondre à un sondage.",
          link:   `/portal/${sondage.association.slug}/sondages/${id}`,
        })),
      skipDuplicates: true,
    })

    await pusherServer.trigger(`private-association-${ctx.associationId}`, "new-notification", {}).catch(() => {})
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_ACTIVATED",
    entity:        "Sondage",
    entityId:      id,
    label:         sondage.title,
  })

  return NextResponse.json({ ok: true })
})

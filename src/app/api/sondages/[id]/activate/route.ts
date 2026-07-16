import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { sendSondageInvitations } from "@/lib/sondage-invitations"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: { recipients: { select: { membreId: true } } },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (sondage.status !== "BROUILLON")
    return NextResponse.json({ error: "Seul un brouillon peut être activé" }, { status: 400 })
  if (sondage.recipientMode === "SELECTED" && sondage.recipients.length === 0)
    return NextResponse.json({ error: "Ajoutez au moins un destinataire avant d'activer" }, { status: 400 })
  if (sondage.deadline && new Date(sondage.deadline) < new Date())
    return NextResponse.json({ error: "La date limite est déjà passée — modifiez-la avant d'activer" }, { status: 400 })

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

  // Send invitations *before* flipping the status. If this throws (DB hiccup, function
  // timeout on a large association) the sondage stays BROUILLON and "Activer" can simply
  // be retried — flipping to ACTIF first would strand it there with partial/no invitations
  // sent and no way to trigger a full resend (activate only accepts BROUILLON).
  const result = await sendSondageInvitations({ sondageId: id, associationId: ctx.associationId, membreIds })

  await prisma.sondage.update({ where: { id }, data: { status: "ACTIF" } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "SONDAGE_ACTIVATED",
    entity:        "Sondage",
    entityId:      id,
    label:         sondage.title,
    metadata:      { emailsSent: result.emailsSent, emailsFailed: result.emailsFailed, skippedNoEmail: result.skippedNoEmail, skippedNoAccess: result.skippedNoAccess },
  })

  return NextResponse.json({ ok: true, ...result })
})

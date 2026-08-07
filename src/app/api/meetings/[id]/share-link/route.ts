import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS       = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const SHARE_TTL_DAYS = 7

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const shareToken     = randomBytes(20).toString("hex")
  const shareExpiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const updated = await prisma.meeting.update({
    where: { id },
    data:  { shareToken, shareExpiresAt },
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "MEETING_SHARE_LINK_GENERATED",
    entity: "Meeting", entityId: id, label: meeting.title,
  })

  return NextResponse.json({ shareToken: updated.shareToken, shareExpiresAt: updated.shareExpiresAt })
}, { roles: MANAGERS, module: "reunions" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const meeting = await prisma.meeting.findFirst({ where: { id, associationId } })
  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  await prisma.meeting.update({ where: { id }, data: { shareToken: null, shareExpiresAt: null } })

  await writeActivityLog({
    associationId, actorId: userId, action: "MEETING_SHARE_LINK_REVOKED",
    entity: "Meeting", entityId: id, label: meeting.title,
  })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS, module: "reunions" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { randomBytes } from "crypto"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS    = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const QR_TTL_HOURS = 24

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const qrToken     = randomBytes(20).toString("hex")
  const qrExpiresAt = new Date(Date.now() + QR_TTL_HOURS * 60 * 60 * 1000)

  const updated = await prisma.evenement.update({
    where: { id },
    data:  { qrToken, qrExpiresAt },
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "EVENEMENT_QR_GENERATED",
    entity: "Evenement", entityId: id, label: evenement.title,
  })

  return NextResponse.json({ qrToken: updated.qrToken, qrExpiresAt: updated.qrExpiresAt })
}, { roles: MANAGERS })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.evenement.update({ where: { id }, data: { qrToken: null, qrExpiresAt: null } })

  await writeActivityLog({
    associationId, actorId: userId, action: "EVENEMENT_QR_REVOKED",
    entity: "Evenement", entityId: id, label: evenement.title,
  })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS })

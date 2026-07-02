import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { randomBytes } from "crypto"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS    = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const QR_TTL_HOURS = 24

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const qrToken     = randomBytes(20).toString("hex")
  const qrExpiresAt = new Date(Date.now() + QR_TTL_HOURS * 60 * 60 * 1000)

  const updated = await prisma.evenement.update({
    where: { id },
    data:  { qrToken, qrExpiresAt },
  })

  return NextResponse.json({ qrToken: updated.qrToken, qrExpiresAt: updated.qrExpiresAt })
}, { roles: MANAGERS })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.evenement.update({ where: { id }, data: { qrToken: null, qrExpiresAt: null } })
  return new NextResponse(null, { status: 204 })
}, { roles: MANAGERS })

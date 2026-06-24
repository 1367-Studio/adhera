import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { randomBytes } from "crypto"

const MANAGERS    = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const QR_TTL_HOURS = 24

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const qrToken     = randomBytes(20).toString("hex")
  const qrExpiresAt = new Date(Date.now() + QR_TTL_HOURS * 60 * 60 * 1000)

  const updated = await prisma.evenement.update({
    where: { id },
    data:  { qrToken, qrExpiresAt },
  })

  return NextResponse.json({ qrToken: updated.qrToken, qrExpiresAt: updated.qrExpiresAt })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.evenement.update({ where: { id }, data: { qrToken: null, qrExpiresAt: null } })
  return new NextResponse(null, { status: 204 })
}

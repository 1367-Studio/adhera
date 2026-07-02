import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { membreTypeUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

const ADMINS = ["ADMIN", "PRESIDENT"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.membreType.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = membreTypeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const type = await prisma.membreType.update({ where: { id }, data: parsed.data })
  await writeActivityLog({ associationId, actorId: userId, action: "TYPE_UPDATED", entity: "MembreType", entityId: id, label: type.name })
  return NextResponse.json(type)
}, { roles: ADMINS })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.membreType.findFirst({
    where:   { id, associationId },
    include: { _count: { select: { membres: { where: { deletedAt: null } } } } },
  })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  if (existing._count.membres > 0) {
    return NextResponse.json(
      { error: `Ce type est utilisé par ${existing._count.membres} membre(s). Réattribuez-les d'abord.` },
      { status: 409 },
    )
  }

  await prisma.membreType.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "TYPE_DELETED", entity: "MembreType", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}, { roles: ADMINS })

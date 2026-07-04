import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { membreTypeSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

const ADMINS = ["ADMIN", "PRESIDENT"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const types = await prisma.membreType.findMany({
    where:   { associationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { membres: true } } },
  })

  return NextResponse.json(types)
})

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json()
  const parsed = membreTypeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const type = await prisma.membreType.create({
    data: { ...parsed.data, associationId },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "TYPE_CREATED", entity: "MembreType", entityId: type.id, label: type.name })
  return NextResponse.json(type, { status: 201 })
}, { roles: ADMINS })

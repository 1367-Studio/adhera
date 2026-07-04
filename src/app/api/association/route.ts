import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { associationSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const association = await prisma.association.findUnique({ where: { id: associationId } })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(association)
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = associationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { city, ...rest } = parsed.data
  const association = await prisma.association.update({
    where: { id: associationId },
    data:  { ...rest, city: city || null },
  })
  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "ASSOCIATION_UPDATED",
    entity:   "Association",
    entityId: associationId,
    label:    association.name,
  })
  return NextResponse.json(association)
}, { roles: ADMINS })

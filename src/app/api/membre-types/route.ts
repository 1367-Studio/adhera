import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { membreTypeSchema } from "@/lib/schemas"

const ADMINS = ["ADMIN", "PRESIDENT"]

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const types = await prisma.membreType.findMany({
    where:   { associationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { membres: true } } },
  })

  return NextResponse.json(types)
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!ADMINS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = membreTypeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const type = await prisma.membreType.create({
    data: { ...parsed.data, associationId },
  })

  return NextResponse.json(type, { status: 201 })
}

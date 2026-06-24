import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { membreTypeUpdateSchema } from "@/lib/schemas"

const ADMINS = ["ADMIN", "PRESIDENT"]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!ADMINS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.membreType.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = membreTypeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const type = await prisma.membreType.update({ where: { id }, data: parsed.data })
  return NextResponse.json(type)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!ADMINS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.membreType.findFirst({
    where:   { id, associationId },
    include: { _count: { select: { membres: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  if (existing._count.membres > 0) {
    return NextResponse.json(
      { error: `Ce type est utilisé par ${existing._count.membres} membre(s). Réattribuez-les d'abord.` },
      { status: 409 },
    )
  }

  await prisma.membreType.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}

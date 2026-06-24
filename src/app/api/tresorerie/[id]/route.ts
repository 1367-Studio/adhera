import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { tresorerieUpdateSchema } from "@/lib/schemas"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.tresorerieEntry.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = tresorerieUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, category, ...rest } = parsed.data
  const entry = await prisma.tresorerieEntry.update({
    where: { id },
    data: {
      ...rest,
      ...(date     ? { date:     new Date(date) }  : {}),
      ...(category !== undefined ? { category: category || null } : {}),
    },
  })

  return NextResponse.json(entry)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.tresorerieEntry.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 })

  await prisma.tresorerieEntry.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}

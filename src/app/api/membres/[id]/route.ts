import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { membreUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeMemberDiff } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { id } = await params
  const membre = await prisma.membre.findFirst({
    where: { id, associationId, deletedAt: null },
    include: {
      cotisations:    { orderBy: { year: "desc" } },
      participations: { include: { evenement: true } },
      user:           { select: { role: true } },
    },
  })

  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  return NextResponse.json(membre)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = membreUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { birthDate, email, phone, address, typeId, ...rest } = parsed.data

  const emailChanged = email !== undefined && email !== existing.email

  if (emailChanged && email && existing.userId) {
    const conflict = await prisma.user.findFirst({
      where: { email, associationId, id: { not: existing.userId } },
    })
    if (conflict) {
      return NextResponse.json({ field: "email", error: "Cet email est déjà utilisé." }, { status: 409 })
    }
  }

  const membre = await prisma.$transaction(async (tx) => {
    const updated = await tx.membre.update({
      where: { id },
      data: {
        ...rest,
        ...(email     !== undefined ? { email:     email     || null }                                      : {}),
        ...(phone     !== undefined ? { phone:     phone     || null }                                      : {}),
        ...(address   !== undefined ? { address:   address   || null }                                      : {}),
        ...(typeId    !== undefined ? { typeId:    typeId    || null }                                      : {}),
        ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null } : {}),
      },
    })

    if (existing.userId) {
      const userUpdate: { email?: string; active?: boolean } = {}
      if (emailChanged)            userUpdate.email  = email || existing.email!
      if (rest.status !== undefined) userUpdate.active = rest.status === "ACTIF"
      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({ where: { id: existing.userId }, data: userUpdate })
      }
    }

    return updated
  })

  const changes = computeMemberDiff(
    existing as unknown as Record<string, unknown>,
    membre   as unknown as Record<string, unknown>,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_UPDATED", entity: "Membre", entityId: id, label: `${membre.firstName} ${membre.lastName}`, metadata: { changes } })
  }

  return NextResponse.json(membre)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.membre.update({ where: { id }, data: { deletedAt: new Date() } })
    if (existing.userId) {
      await tx.user.update({ where: { id: existing.userId }, data: { active: false } })
    }
  })

  await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_DELETED", entity: "Membre", entityId: id, label: `${existing.firstName} ${existing.lastName}` })

  return new NextResponse(null, { status: 204 })
}

import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const ASSIGNABLE_ROLES = ["MEMBRE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"] as const
type AssignableRole = typeof ASSIGNABLE_ROLES[number]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role: actorRole, userId: actorId } = ctx

  if (actorRole !== "ADMIN") {
    return NextResponse.json({ error: "Seul un administrateur peut modifier les rôles" }, { status: 403 })
  }

  const { id } = await params
  const { role } = await req.json() as { role: AssignableRole }

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Rôle invalide" }, { status: 422 })
  }

  const membre = await prisma.membre.findFirst({
    where:  { id, associationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, userId: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  if (!membre.userId) {
    return NextResponse.json({ error: "Ce membre n'a pas de compte portail" }, { status: 422 })
  }

  await prisma.user.update({ where: { id: membre.userId }, data: { role } })

  await writeActivityLog({
    associationId,
    actorId,
    action:   "MEMBRE_ROLE_CHANGED",
    entity:   "Membre",
    entityId: id,
    label:    `${membre.firstName} ${membre.lastName}`,
    metadata: { role },
  })

  return NextResponse.json({ ok: true })
}

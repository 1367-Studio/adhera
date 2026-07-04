import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

const ASSIGNABLE_ROLES = ["MEMBRE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"] as const
type AssignableRole = typeof ASSIGNABLE_ROLES[number]

const PRESIDENT_ASSIGNABLE_ROLES: AssignableRole[] = ["MEMBRE", "SECRETAIRE", "TRESORIER", "PRESIDENT"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, role: actorRole, userId: actorId } = ctx

  if (actorRole !== "ADMIN" && actorRole !== "PRESIDENT") {
    return NextResponse.json({ error: "Seul un administrateur ou le président peut modifier les rôles" }, { status: 403 })
  }

  const { role } = await req.json() as { role: AssignableRole }

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Rôle invalide" }, { status: 422 })
  }

  const membre = await prisma.membre.findFirst({
    where:   { id, associationId, deletedAt: null },
    select:  { id: true, firstName: true, lastName: true, userId: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  if (!membre.userId) {
    return NextResponse.json({ error: "Ce membre n'a pas de compte portail" }, { status: 422 })
  }

  if (membre.userId === actorId) {
    return NextResponse.json({ error: "Vous ne pouvez pas modifier votre propre rôle" }, { status: 403 })
  }

  const target = await prisma.user.findUnique({ where: { id: membre.userId }, select: { role: true } })

  if (actorRole === "PRESIDENT") {
    if (target?.role === "ADMIN") {
      return NextResponse.json({ error: "Le président ne peut pas modifier le rôle d'un administrateur" }, { status: 403 })
    }
    if (!PRESIDENT_ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: "Le président ne peut pas attribuer le rôle administrateur" }, { status: 403 })
    }
  }

  if (target?.role === "ADMIN" && role !== "ADMIN") {
    const remainingAdmins = await prisma.user.count({
      where: { associationId, role: "ADMIN", deletedAt: null, id: { not: membre.userId } },
    })
    if (remainingAdmins === 0) {
      return NextResponse.json({ error: "Impossible de rétrograder le dernier administrateur" }, { status: 422 })
    }
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
})

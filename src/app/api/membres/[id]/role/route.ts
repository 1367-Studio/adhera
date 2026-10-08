import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { resolvePermissions } from "@/lib/permissions"
import { checkTeamAccessChange, TEAM_ASSIGNABLE_ROLES, type TeamAssignableRole } from "@/lib/team-access"
import { alertAdministratorPermissionChange } from "@/lib/security-alerts"

const ASSIGNABLE_ROLES: readonly TeamAssignableRole[] = TEAM_ASSIGNABLE_ROLES

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, role: actorRole, userId: actorId } = ctx

  const { role } = await req.json() as { role: TeamAssignableRole }

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

  const target = await prisma.user.findUnique({ where: { id: membre.userId }, select: { role: true, permissions: true } })

  // A new function starts from that function's profile: access customized for the previous
  // role (FORM-34) must not silently follow the person into the new one.
  const roleChanged = target?.role !== role

  // Same guards as Paramètres › Équipe et accès (src/lib/team-access.ts): not yourself,
  // administrator rights only touched by an administrator, never the last administrator. A
  // role change resets permissions to the new role's profile (see below), so the resulting
  // administrator status is that profile's rather than the target's current permissions.
  const targetWasAdministrator    = resolvePermissions(target?.role ?? "MEMBRE", target?.permissions ?? null).administrator
  const targetWillBeAdministrator = resolvePermissions(role, roleChanged ? null : target?.permissions ?? null).administrator

  const refusal = await checkTeamAccessChange({
    associationId,
    actorId,
    actorRole,
    targetUserId:          membre.userId,
    targetRole:            target?.role ?? "MEMBRE",
    targetIsAdministrator: targetWasAdministrator,
    nextRole:              role,
    nextIsAdministrator:   targetWillBeAdministrator,
  })
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })

  await prisma.user.update({
    where: { id: membre.userId },
    data:  roleChanged ? { role, permissions: Prisma.DbNull } : { role },
  })

  await writeActivityLog({
    associationId,
    actorId,
    action:   "MEMBRE_ROLE_CHANGED",
    entity:   "Membre",
    entityId: id,
    label:    `${membre.firstName} ${membre.lastName}`,
    metadata: { role, changes: roleChanged ? { role: { old: target?.role ?? null, new: role } } : {} },
  })

  // Security audit M1 — this route can flip the `administrator` flag exactly like PATCH
  // /api/equipe/[userId] (a role change here resets permissions to the new role's profile),
  // so it must fire the same alert instead of leaving this a silent second path around it.
  if (targetWasAdministrator !== targetWillBeAdministrator) {
    const [association, actor] = await Promise.all([
      prisma.association.findUnique({ where: { id: associationId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } }),
    ])
    if (association && actor) {
      alertAdministratorPermissionChange({
        associationName: association.name,
        targetName:      `${membre.firstName} ${membre.lastName}`,
        actorName:       actor.name || actor.email,
        granted:         targetWillBeAdministrator,
      })
    }
  }

  return NextResponse.json({ ok: true })
}, { administrator: true })

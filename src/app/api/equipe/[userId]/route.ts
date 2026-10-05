import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import {
  ACCESS_AREAS, ACCESS_LEVELS, isStaffRole, resolvePermissions, toStoredPermissions,
  type AccessLevel, type ResolvedPermissions,
} from "@/lib/permissions"
import { checkTeamAccessChange, describeStoredPermissions, TEAM_ASSIGNABLE_ROLES } from "@/lib/team-access"

const teamMemberUpdateSchema = z.object({
  role:        z.enum(TEAM_ASSIGNABLE_ROLES).optional(),
  // null = back to the profile of the role (ROLE_PROFILES). Areas left out count as "none".
  permissions: z.object({
    administrator: z.boolean(),
    areas:         z.partialRecord(z.enum(ACCESS_AREAS), z.enum(ACCESS_LEVELS as [AccessLevel, ...AccessLevel[]])),
  }).nullable().optional(),
})

// Paramètres › Équipe et accès (FORM-34): function and per-area access of one staff account.
export const PATCH = withAdminAuth<{ userId: string }>(async (req, ctx, { userId: targetUserId }) => {
  const { associationId, role: actorRole, userId: actorId } = ctx

  const parsed = teamMemberUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  const { role: requestedRole, permissions: requestedPermissions } = parsed.data

  const target = await prisma.user.findFirst({
    where:  { id: targetUserId, associationId, deletedAt: null },
    select: {
      id: true, name: true, email: true, role: true, permissions: true,
      membre: { select: { id: true, firstName: true, lastName: true, deletedAt: true } },
    },
  })
  if (!target || !isStaffRole(target.role)) {
    return NextResponse.json({ error: "Membre de l'équipe introuvable" }, { status: 404 })
  }

  const nextRole    = requestedRole ?? target.role
  const roleChanged = nextRole !== target.role

  // What ends up in User.permissions. Null whenever it would mean nothing or something stale:
  // a member (no dashboard), an ADMIN (always administrator), or a new function without an
  // explicit choice — it then starts from that function's profile.
  let nextStoredPermissions: Prisma.InputJsonValue | typeof Prisma.DbNull
  if (nextRole === "MEMBRE" || nextRole === "ADMIN" || requestedPermissions === null) {
    nextStoredPermissions = Prisma.DbNull
  } else if (requestedPermissions) {
    const areaLevels = Object.fromEntries(
      ACCESS_AREAS.map(area => [area, requestedPermissions.areas[area] ?? "none"]),
    ) as ResolvedPermissions["areas"]
    nextStoredPermissions = toStoredPermissions({ administrator: requestedPermissions.administrator, areas: areaLevels })
  } else if (roleChanged || target.permissions === null) {
    nextStoredPermissions = Prisma.DbNull
  } else {
    nextStoredPermissions = target.permissions as Prisma.InputJsonValue
  }

  const refusal = await checkTeamAccessChange({
    associationId,
    actorId,
    actorRole,
    targetUserId:          target.id,
    targetRole:            target.role,
    targetIsAdministrator: resolvePermissions(target.role, target.permissions).administrator,
    nextRole:              requestedRole,
    nextIsAdministrator:   resolvePermissions(nextRole, nextStoredPermissions === Prisma.DbNull ? null : nextStoredPermissions).administrator,
  })
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })

  const updatedUser = await prisma.user.update({
    where:  { id: target.id },
    data:   { role: nextRole, permissions: nextStoredPermissions },
    select: { role: true, permissions: true },
  })

  const previousAccess = describeStoredPermissions(target.permissions, resolvePermissions(target.role, target.permissions))
  const nextAccess     = describeStoredPermissions(updatedUser.permissions, resolvePermissions(updatedUser.role, updatedUser.permissions))
  const changes: Record<string, { old: string | null; new: string | null }> = {}
  if (roleChanged) changes.role = { old: target.role, new: nextRole }
  if (previousAccess !== nextAccess) changes.permissions = { old: previousAccess, new: nextAccess }

  if (Object.keys(changes).length > 0) {
    const linkedMembre = target.membre && !target.membre.deletedAt ? target.membre : null
    await writeActivityLog({
      associationId,
      actorId,
      action:   "MEMBRE_ROLE_CHANGED",
      entity:   linkedMembre ? "Membre" : "User",
      entityId: linkedMembre?.id ?? target.id,
      label:    linkedMembre ? `${linkedMembre.firstName} ${linkedMembre.lastName}` : (target.name || target.email),
      metadata: { role: nextRole, changes },
    })
  }

  return NextResponse.json({ ok: true })
}, { administrator: true })

// Guards shared by every screen that changes who can do what in the dashboard (FORM-34):
// the role dialog of the Membres list (api/membres/[id]/role) and Paramètres › Équipe et accès
// (api/equipe/[userId]). Both must refuse exactly the same things, otherwise one screen becomes
// the way around the other.
import { prisma } from "@/lib/prisma/client"
import {
  ACCESS_AREAS, ACCESS_AREA_LABELS, STAFF_ROLES, resolvePermissions, type ResolvedPermissions,
} from "@/lib/permissions"

export const TEAM_ASSIGNABLE_ROLES = ["MEMBRE", "EQUIPE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"] as const
export type TeamAssignableRole = (typeof TEAM_ASSIGNABLE_ROLES)[number]

// Display order of the team: bureau first, then the volunteers.
export const TEAM_ROLE_ORDER = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE", "EQUIPE"] as const

export type TeamGuardFailure = { error: string; status: number }

/**
 * Number of OTHER active staff accounts of the association that currently resolve as
 * administrator — role ADMIN, or any staff role granted the custom "administrator" permission.
 * Used by the last-admin guard below: counting only the literal ADMIN role would miss a
 * PRESIDENT or EQUIPE member currently holding full admin rights through custom permissions.
 */
async function countOtherAdministrators(associationId: string, excludingUserId: string): Promise<number> {
  const others = await prisma.user.findMany({
    where:  { associationId, active: true, deletedAt: null, id: { not: excludingUserId }, role: { in: [...STAFF_ROLES] } },
    select: { role: true, permissions: true },
  })
  return others.filter(user => resolvePermissions(user.role, user.permissions).administrator).length
}

/**
 * Email addresses of every active administrator of the association — role ADMIN, or any
 * staff role granted the custom "administrator" permission, same resolution as the guard
 * above. `excludingUserId` leaves out the admin who just performed the action being
 * notified about (they already know; this is for the rest of the team).
 */
export async function getAdministratorEmails(associationId: string, excludingUserId?: string): Promise<string[]> {
  const staff = await prisma.user.findMany({
    where:  {
      associationId, active: true, deletedAt: null, role: { in: [...STAFF_ROLES] },
      ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
    },
    select: { role: true, permissions: true, email: true },
  })
  return staff.filter(user => resolvePermissions(user.role, user.permissions).administrator).map(user => user.email)
}

/**
 * Checks that `actor` may change the access of `target` — to `nextRole` and/or
 * `nextIsAdministrator`, whichever the caller is changing. Returns null when allowed.
 * - nobody edits their own access (a mistaken click would lock them out);
 * - only the ADMIN role touches an account that is currently an administrator (by role or by
 *   permission), or hands out the ADMIN role or the "administrator" permission — any other
 *   administrator (the président, or a team member granted "administrator") gets the
 *   président's limits;
 * - the last active administrator of the association cannot be demoted, whether that demotion
 *   happens through the role or through the permissions payload.
 */
export async function checkTeamAccessChange({
  associationId, actorId, actorRole, targetUserId, targetRole, targetIsAdministrator,
  nextRole, nextIsAdministrator,
}: {
  associationId:          string
  actorId:                string
  actorRole:              string
  targetUserId:           string
  targetRole:             string
  targetIsAdministrator:  boolean
  nextRole?:              TeamAssignableRole
  nextIsAdministrator:    boolean
}): Promise<TeamGuardFailure | null> {
  if (targetUserId === actorId) {
    return { error: "Vous ne pouvez pas modifier votre propre rôle ni vos propres accès", status: 403 }
  }

  if (actorRole !== "ADMIN") {
    if (targetRole === "ADMIN" || targetIsAdministrator) {
      return { error: "Seul un administrateur peut modifier les accès d'un administrateur", status: 403 }
    }
    if (nextRole === "ADMIN" || nextIsAdministrator) {
      return { error: "Seul un administrateur peut attribuer le rôle ou les droits d'administrateur", status: 403 }
    }
  }

  if (targetIsAdministrator && !nextIsAdministrator) {
    const remainingAdmins = await countOtherAdministrators(associationId, targetUserId)
    if (remainingAdmins === 0) {
      return { error: "Impossible de rétrograder le dernier administrateur", status: 422 }
    }
  }

  return null
}

/**
 * Guards deactivating a staff account outside the role/permissions screens — a Membre's linked
 * User can also lose admin rights by being deleted or suspended from the Membres screen, which
 * must not be a side door around the last-admin guard above.
 */
export async function assertCanDeactivateAdministrator(
  associationId: string, targetUserId: string,
): Promise<TeamGuardFailure | null> {
  const target = await prisma.user.findUnique({
    where:  { id: targetUserId },
    select: { role: true, permissions: true },
  })
  if (!target || !resolvePermissions(target.role, target.permissions).administrator) return null

  const remainingAdmins = await countOtherAdministrators(associationId, targetUserId)
  if (remainingAdmins === 0) {
    return { error: "Impossible de désactiver le dernier administrateur de l'association", status: 422 }
  }
  return null
}

const LEVEL_LABELS = { read: "lecture", edit: "édition" } as const

/** Human-readable access for the activity log ("Profil du rôle", "Administrateur", areas…). */
export function describeStoredPermissions(stored: unknown, resolved: ResolvedPermissions): string {
  if (stored === null || stored === undefined) return "Profil du rôle"
  if (resolved.administrator) return "Administrateur"
  const grantedAreas = ACCESS_AREAS
    .filter(area => resolved.areas[area] !== "none")
    .map(area => `${ACCESS_AREA_LABELS[area]} : ${LEVEL_LABELS[resolved.areas[area] as "read" | "edit"]}`)
  return grantedAreas.length > 0 ? grantedAreas.join(", ") : "Aucun accès"
}

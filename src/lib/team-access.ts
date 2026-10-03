// Guards shared by every screen that changes who can do what in the dashboard (FORM-34):
// the role dialog of the Membres list (api/membres/[id]/role) and Paramètres › Équipe et accès
// (api/equipe/[userId]). Both must refuse exactly the same things, otherwise one screen becomes
// the way around the other.
import { prisma } from "@/lib/prisma/client"
import {
  ACCESS_AREAS, ACCESS_AREA_LABELS, type ResolvedPermissions,
} from "@/lib/permissions"

export const TEAM_ASSIGNABLE_ROLES = ["MEMBRE", "EQUIPE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"] as const
export type TeamAssignableRole = (typeof TEAM_ASSIGNABLE_ROLES)[number]

// Display order of the team: bureau first, then the volunteers.
export const TEAM_ROLE_ORDER = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE", "EQUIPE"] as const

export type TeamGuardFailure = { error: string; status: number }

/**
 * Checks that `actor` may change the access of `target` — and, when `nextRole` is given, give
 * it that role. Returns null when allowed.
 * - nobody edits their own access (a mistaken click would lock them out);
 * - only the ADMIN role touches an ADMIN or hands out ADMIN — any other administrator (the
 *   président, or a team member granted "administrator") gets the président's limits;
 * - the last active ADMIN of the association cannot be demoted.
 */
export async function checkTeamAccessChange({
  associationId, actorId, actorRole, targetUserId, targetRole, nextRole,
}: {
  associationId: string
  actorId:       string
  actorRole:     string
  targetUserId:  string
  targetRole:    string
  nextRole?:     TeamAssignableRole
}): Promise<TeamGuardFailure | null> {
  if (targetUserId === actorId) {
    return { error: "Vous ne pouvez pas modifier votre propre rôle ni vos propres accès", status: 403 }
  }

  if (actorRole !== "ADMIN") {
    if (targetRole === "ADMIN") {
      return { error: "Seul un administrateur peut modifier les accès d'un administrateur", status: 403 }
    }
    if (nextRole === "ADMIN") {
      return { error: "Seul un administrateur peut attribuer le rôle administrateur", status: 403 }
    }
  }

  if (targetRole === "ADMIN" && nextRole !== undefined && nextRole !== "ADMIN") {
    const remainingAdmins = await prisma.user.count({
      where: { associationId, role: "ADMIN", active: true, deletedAt: null, id: { not: targetUserId } },
    })
    if (remainingAdmins === 0) {
      return { error: "Impossible de rétrograder le dernier administrateur", status: 422 }
    }
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

import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { STAFF_ROLES, resolvePermissions } from "@/lib/permissions"
import { TEAM_ROLE_ORDER } from "@/lib/team-access"

// Paramètres › Équipe et accès (FORM-34): every account that opens the dashboard, with its
// effective access. Administrators only, like everything that hands out access.
export const GET = withAdminAuth(async (_req, ctx) => {
  const staffUsers = await prisma.user.findMany({
    where:  { associationId: ctx.associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null },
    select: {
      id: true, name: true, email: true, role: true, permissions: true,
      membre: { select: { id: true, firstName: true, lastName: true, deletedAt: true } },
    },
  })

  const teamMembers = staffUsers.map(staffUser => {
    const linkedMembre = staffUser.membre && !staffUser.membre.deletedAt ? staffUser.membre : null
    const membreName   = linkedMembre ? `${linkedMembre.firstName} ${linkedMembre.lastName}`.trim() : ""
    return {
      userId:      staffUser.id,
      membreId:    linkedMembre?.id ?? null,
      name:        membreName || staffUser.name || staffUser.email,
      email:       staffUser.email,
      role:        staffUser.role,
      isCustom:    staffUser.role !== "ADMIN" && staffUser.permissions !== null,
      permissions: resolvePermissions(staffUser.role, staffUser.permissions),
    }
  })

  const roleRank = (role: string) => (TEAM_ROLE_ORDER as readonly string[]).indexOf(role)
  teamMembers.sort((first, second) =>
    roleRank(first.role) - roleRank(second.role) || first.name.localeCompare(second.name, "fr"),
  )

  return NextResponse.json(teamMembers)
}, { administrator: true })

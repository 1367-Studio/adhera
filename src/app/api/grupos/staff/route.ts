import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { STAFF_ROLES } from "@/lib/permissions"

// Liste restreinte des comptes de l'équipe, pour le sélecteur "responsable du groupe" — pas
// le même accès que /api/equipe (administrator: true), car gérer les responsables d'un groupe
// n'exige que groupes:edit (ex. un SECRETAIRE sans être administrateur).
export const GET = withAdminAuth(async (_req, ctx) => {
  const staffUsers = await prisma.user.findMany({
    where:  { associationId: ctx.associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(staffUsers)
}, { area: "groupes", access: "edit", module: "groupes" })

import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { grantMembrePortalAccess } from "@/lib/membre-access"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Members created via public self-registration (or imported without an account) have
// `userId: null` and can never log in — this gives an admin a way to grant portal access
// after the fact instead of the only option being delete-and-recreate the member.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const membre = await prisma.membre.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const result = await grantMembrePortalAccess({ membre, associationId, actorId: userId, association: assoc })
  if (!result.ok) {
    if (result.reason === "already_has_access") return NextResponse.json({ error: "Ce membre a déjà un accès" }, { status: 409 })
    if (result.reason === "no_email") return NextResponse.json({ error: "Cet membre n'a pas d'email renseigné" }, { status: 422 })
    const error = result.conflictMembreName
      ? `Cet email est déjà utilisé par le compte de ${result.conflictMembreName}`
      : "Un compte existe déjà avec cet email"
    return NextResponse.json({ error }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}, { roles: MANAGERS })

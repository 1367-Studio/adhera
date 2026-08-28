import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import type { AssociationPlan } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { invitationEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"
import { APP_URL } from "@/lib/env"
import { resolveDocumentBranding } from "@/lib/plan-limits"

export type GrantAccessResult =
  | { ok: true }
  | { ok: false; reason: "already_has_access" | "no_email" | "email_conflict"; conflictMembreName?: string }

// Extracted from the single-member "Créer un accès" route so the bulk import's optional
// portal-invite step (see src/inngest/membres-import.ts) can grant access the exact same
// way, one call per member, without duplicating the password/User/email/activity-log dance.
export async function grantMembrePortalAccess(params: {
  membre: { id: string; firstName: string; lastName: string; email: string | null; userId: string | null }
  associationId: string
  actorId: string | null
  association: { name: string; slug: string; plan: AssociationPlan; customBrandingEnabled: boolean | null; logoUrl: string | null }
}): Promise<GrantAccessResult> {
  const { membre, associationId, actorId, association } = params

  if (membre.userId) return { ok: false, reason: "already_has_access" }
  if (!membre.email) return { ok: false, reason: "no_email" }

  const conflict = await prisma.user.findFirst({
    where: { email: membre.email, associationId, deletedAt: null },
  })
  if (conflict) {
    const conflictMembre = await prisma.membre.findFirst({
      where:  { userId: conflict.id, associationId, deletedAt: null },
      select: { firstName: true, lastName: true },
    })
    return {
      ok: false,
      reason: "email_conflict",
      conflictMembreName: conflictMembre ? `${conflictMembre.firstName} ${conflictMembre.lastName}` : undefined,
    }
  }

  const plainPassword = randomBytes(6).toString("hex")
  const passwordHash  = await bcrypt.hash(plainPassword, 12)
  const email          = membre.email

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name:          `${membre.firstName} ${membre.lastName}`,
        passwordHash,
        role:          "MEMBRE",
        associationId,
      },
    })
    await tx.membre.update({ where: { id: membre.id }, data: { userId: user.id, status: "ACTIF" } })
  })

  sendEmail(invitationEmail({
    firstName:       membre.firstName,
    email,
    password:        plainPassword,
    associationName: association.name,
    role:            "MEMBRE",
    loginUrl:        `${APP_URL}/portal/${association.slug}/login`,
    branding:        resolveDocumentBranding(association),
  }), { associationId, membreId: membre.id, source: "MEMBER_INVITE" }).catch(() => {})

  await writeActivityLog({
    associationId,
    actorId,
    action:   "MEMBRE_ACCESS_CREATED",
    entity:   "Membre",
    entityId: membre.id,
    label:    `${membre.firstName} ${membre.lastName}`,
  })

  return { ok: true }
}

import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { STAFF_ROLES } from "@/lib/permissions"
import { resolveBoutiqueResponsable } from "@/lib/boutique/responsable"

// Who gets e-mailed on a new Boutique sale (online once paid, manual on the admin's choice) —
// see bookBoutiqueOrderIncome call sites and boutiqueNewOrderAdminEmail. Administrators only,
// same boundary as /api/equipe (choosing who receives these alerts is a team/access-level
// decision, not a day-to-day Boutique edit).
export const GET = withAdminAuth(async (_req, ctx) => {
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const [responsable, eligibleUsers] = await Promise.all([
    resolveBoutiqueResponsable(ctx.associationId),
    prisma.user.findMany({
      where:  { associationId: ctx.associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ])

  // If the configured responsable has since been deactivated/removed, this already reports
  // "no responsable" (resolveBoutiqueResponsable returns null) — nudging the admin to pick
  // someone still active instead of silently keeping an ex-staff account as the target.
  return NextResponse.json({
    responsableId: responsable?.id ?? null,
    responsable:   responsable,
    users:         eligibleUsers.map(u => ({ id: u.id, name: u.name || u.email, email: u.email })),
  })
}, { administrator: true })

const patchSchema = z.object({ responsableId: z.string().nullable() })

export const PATCH = withAdminAuth(async (req, ctx) => {
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const body   = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { responsableId } = parsed.data
  if (responsableId) {
    // Same eligibility as the GET's dropdown (role in STAFF_ROLES) — checked again here, not
    // just trusted from the UI, so a crafted request can't hand sales-notification e-mails to
    // a plain MEMBRE account.
    const user = await prisma.user.findFirst({ where: { id: responsableId, associationId: ctx.associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null } })
    if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 })
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { boutiqueResponsableId: responsableId },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    entityId:      ctx.associationId,
    label:         responsableId ? "Responsable boutique mis à jour" : "Responsable boutique retiré",
  })

  return NextResponse.json({ responsableId })
}, { administrator: true })

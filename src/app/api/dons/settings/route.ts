import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { STAFF_ROLES } from "@/lib/permissions"
import { resolveDonResponsable } from "@/lib/dons/responsable"

// Who gets notified (in-app + e-mail) on a new don — online once paid, offline as soon as
// recorded, manual on the admin's choice. Administrators only, same boundary as /api/equipe
// and /api/boutique/settings (choosing who receives these alerts is a team/access-level
// decision, not a day-to-day Dons edit).
export const GET = withAdminAuth(async (_req, ctx) => {
  const [responsable, eligibleUsers] = await Promise.all([
    resolveDonResponsable(ctx.associationId),
    prisma.user.findMany({
      where:  { associationId: ctx.associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ])

  return NextResponse.json({
    responsableId: responsable?.id ?? null,
    responsable:   responsable,
    users:         eligibleUsers.map(u => ({ id: u.id, name: u.name || u.email, email: u.email })),
  })
}, { administrator: true, module: "dons" })

const patchSchema = z.object({ responsableId: z.string().nullable() })

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { responsableId } = parsed.data
  if (responsableId) {
    // Same eligibility as the GET's dropdown (role in STAFF_ROLES) — checked again here, not
    // just trusted from the UI, so a crafted request can't hand don-notification e-mails to
    // a plain MEMBRE account.
    const user = await prisma.user.findFirst({ where: { id: responsableId, associationId: ctx.associationId, role: { in: [...STAFF_ROLES] }, active: true, deletedAt: null } })
    if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 })
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { donResponsableId: responsableId },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    entityId:      ctx.associationId,
    label:         responsableId ? "Responsable des dons mis à jour" : "Responsable des dons retiré",
  })

  return NextResponse.json({ responsableId })
}, { administrator: true, module: "dons" })

import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

// FORM-114 — manual edit of a MembershipLicense's status/number by an authorized admin. Same
// "edit" permission as the tier config that produced it (Adhésions), never auto-granted by a
// payment — status is never flipped to VALIDADA anywhere except here.
const schema = z.object({
  status:        z.enum(["A_SOLICITAR", "EM_ANDAMENTO", "VALIDADA", "A_RENOVAR"]).optional(),
  licenseNumber: z.string().trim().max(50).nullable().optional(),
})

export const PATCH = withAdminAuth<{ id: string; licenseId: string }>(async (req, ctx, { id, licenseId }) => {
  const license = await prisma.membershipLicense.findFirst({
    where: { id: licenseId, membreId: id, associationId: ctx.associationId },
  })
  if (!license) return NextResponse.json({ error: "Licença introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const updated = await prisma.membershipLicense.update({
    where: { id: licenseId },
    data:  {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.licenseNumber !== undefined ? { licenseNumber: parsed.data.licenseNumber || null } : {}),
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "MEMBRE_LICENSE_UPDATED",
    entity:        "MembershipLicense",
    entityId:      updated.id,
    label:         `${updated.federation} — ${updated.season}`,
  })

  return NextResponse.json(updated)
}, { area: "adhesions", access: "edit" })

// FORM-114 — lets an admin remove a mistakenly-created record (e.g. the public form's own
// "declare existing license" checked by accident). Blocked once VALIDADA — same reasoning as
// the Cotisation delete route's own guard: that status means the club already confirmed this
// with the federation, and a delete button must not be the thing that silently erases it.
export const DELETE = withAdminAuth<{ id: string; licenseId: string }>(async (_req, ctx, { id, licenseId }) => {
  const license = await prisma.membershipLicense.findFirst({
    where: { id: licenseId, membreId: id, associationId: ctx.associationId },
  })
  if (!license) return NextResponse.json({ error: "Licença introuvable" }, { status: 404 })

  if (license.status === "VALIDADA") {
    return NextResponse.json(
      { error: "Cette licence a déjà été validée — changez son statut avant de la supprimer." },
      { status: 422 },
    )
  }

  await prisma.membershipLicense.delete({ where: { id: licenseId } })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "MEMBRE_LICENSE_DELETED",
    entity:        "MembershipLicense",
    entityId:      licenseId,
    label:         `${license.federation} — ${license.season}`,
  })

  return new NextResponse(null, { status: 204 })
}, { area: "adhesions", access: "edit" })

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementCustomFieldsSchema } from "@/lib/schemas/evenement"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId }, select: { id: true } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const fields = await prisma.evenementCustomField.findMany({
    where:   { evenementId: id },
    orderBy: { order: "asc" },
  })
  return NextResponse.json(fields)
})

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = evenementCustomFieldsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const fields = await prisma.$transaction(async (tx) => {
    // Upsert by id (scoped to this event, so a client-supplied id from elsewhere can
    // never hijack another association's row — it just falls through to "create new")
    // instead of the previous delete-all/recreate-all, which minted fresh ids on every
    // save and silently orphaned any Participation.answers already keyed by the old ids.
    const existing   = await tx.evenementCustomField.findMany({ where: { evenementId: id }, select: { id: true } })
    const existingIds = new Set(existing.map(f => f.id))
    const incomingIds = new Set(parsed.data.filter(f => f.id).map(f => f.id))

    const toDelete = [...existingIds].filter(fid => !incomingIds.has(fid))
    if (toDelete.length) {
      await tx.evenementCustomField.deleteMany({ where: { id: { in: toDelete } } })
    }

    for (const [order, f] of parsed.data.entries()) {
      if (f.id && existingIds.has(f.id)) {
        await tx.evenementCustomField.update({
          where: { id: f.id },
          data:  { type: f.type, label: f.label, required: f.required ?? false, order },
        })
      } else {
        await tx.evenementCustomField.create({
          data: { evenementId: id, type: f.type, label: f.label, required: f.required ?? false, order },
        })
      }
    }

    return tx.evenementCustomField.findMany({ where: { evenementId: id }, orderBy: { order: "asc" } })
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "EVENEMENT_UPDATED", entity: "Evenement", entityId: id,
    label: evenement.title, metadata: { customFieldsCount: fields.length },
  })

  return NextResponse.json(fields)
}, { roles: MANAGERS, module: "evenements" })

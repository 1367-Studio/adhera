import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:    z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(200).optional(),
  body:    z.string().min(1).optional(),
  smsBody: z.string().optional(),
})

async function resolve(id: string, associationId: string) {
  return prisma.messageTemplate.findFirst({ where: { id, associationId } })
}

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const updateData: Record<string, unknown> = {}
  if (parsed.data.name    != null) updateData.name    = parsed.data.name
  if (parsed.data.subject != null) updateData.subject = parsed.data.subject
  if (parsed.data.body    != null) updateData.body    = parsed.data.body
  if ("smsBody" in parsed.data)    updateData.smsBody = parsed.data.smsBody || null

  const updated = await prisma.messageTemplate.update({ where: { id }, data: updateData })
  await writeActivityLog({ associationId, actorId: userId, action: "TEMPLATE_UPDATED", entity: "MessageTemplate", entityId: id, label: updated.name })
  return NextResponse.json(updated)
}, { roles: ALLOWED_ROLES })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const usedByRules = await prisma.automationRule.count({ where: { templateId: id } })
  if (usedByRules > 0) {
    return NextResponse.json({ error: "Ce modèle est utilisé par des règles actives. Supprimez-les d'abord." }, { status: 409 })
  }

  await prisma.messageTemplate.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "TEMPLATE_DELETED", entity: "MessageTemplate", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}, { roles: ALLOWED_ROLES })

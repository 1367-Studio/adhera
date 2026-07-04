import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { computeNextRunAt } from "@/lib/automation"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:          z.string().min(1).max(100).optional(),
  templateId:    z.string().min(1).optional(),
  triggerType:   z.enum(["SCHEDULED_ONCE", "SCHEDULED_RECURRING", "EVENT_COTISATION_DUE", "EVENT_PAYMENT_OVERDUE", "EVENT_REMINDER", "RSVP_CONFIRMED", "MEMBER_CREATED"]).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  recipients:    z.string().optional(),
  channel:       z.enum(["EMAIL", "SMS", "BOTH"]).optional(),
  status:        z.enum(["ACTIVE", "PAUSED", "DONE"]).optional(),
})

async function resolve(id: string, associationId: string) {
  return prisma.automationRule.findFirst({ where: { id, associationId } })
}

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const triggerType   = parsed.data.triggerType   ?? existing.triggerType
  const triggerConfig = parsed.data.triggerConfig ?? (existing.triggerConfig as Record<string, unknown>)

  const nextRunAt =
    parsed.data.triggerType || parsed.data.triggerConfig || parsed.data.status === "ACTIVE"
      ? computeNextRunAt(triggerType, triggerConfig)
      : undefined

  const data: Prisma.AutomationRuleUncheckedUpdateInput = {}
  if (parsed.data.name          != null) data.name          = parsed.data.name
  if (parsed.data.templateId    != null) data.templateId    = parsed.data.templateId
  if (parsed.data.triggerType   != null) data.triggerType   = parsed.data.triggerType
  if (parsed.data.triggerConfig != null) data.triggerConfig = parsed.data.triggerConfig as Prisma.InputJsonObject
  if (parsed.data.recipients    != null) data.recipients    = parsed.data.recipients
  if (parsed.data.channel       != null) data.channel       = parsed.data.channel
  if (parsed.data.status        != null) data.status        = parsed.data.status
  if (nextRunAt                 != null) data.nextRunAt     = nextRunAt

  const updated = await prisma.automationRule.update({
    where: { id },
    data,
    include: { template: { select: { name: true } } },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "RULE_UPDATED", entity: "AutomationRule", entityId: id, label: updated.name, metadata: parsed.data.status ? { status: parsed.data.status } : undefined })
  return NextResponse.json(updated)
}, { roles: ALLOWED_ROLES })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await resolve(id, associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  await prisma.automationRule.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "RULE_DELETED", entity: "AutomationRule", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}, { roles: ALLOWED_ROLES })

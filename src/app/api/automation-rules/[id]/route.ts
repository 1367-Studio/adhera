import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { computeNextRunAt, birthdayRecipientsConflict, isBirthdayConflictError, BIRTHDAY_CONFLICT_MESSAGE } from "@/lib/automation"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:          z.string().min(1).max(100).optional(),
  templateId:    z.string().min(1).optional(),
  triggerType:   z.enum(["SCHEDULED_ONCE", "SCHEDULED_RECURRING", "EVENT_COTISATION_DUE", "EVENT_PAYMENT_OVERDUE", "EVENT_REMINDER", "RSVP_CONFIRMED", "MEMBER_CREATED", "MEMBER_BIRTHDAY"]).optional(),
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
  const recipients    = parsed.data.recipients    ?? existing.recipients
  const status        = parsed.data.status        ?? existing.status

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

  const include = { template: { select: { name: true, active: true } } }

  let updated
  if (triggerType === "MEMBER_BIRTHDAY" && status === "ACTIVE") {
    // Same guard as on create: block an active MEMBER_BIRTHDAY rule whose recipients
    // overlap another active one. Check + update run in one serializable transaction so
    // two concurrent requests can't both pass the check before either commits.
    try {
      updated = await prisma.$transaction(async tx => {
        const others = await tx.automationRule.findMany({
          where:  { associationId, id: { not: id }, triggerType: "MEMBER_BIRTHDAY", status: "ACTIVE" },
          select: { recipients: true },
        })
        if (birthdayRecipientsConflict(recipients, others.map(o => o.recipients))) {
          throw new Error(BIRTHDAY_CONFLICT_MESSAGE)
        }
        return tx.automationRule.update({ where: { id }, data, include })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (err) {
      if (isBirthdayConflictError(err)) {
        return NextResponse.json({ error: "Une règle Anniversaire active existe déjà pour des destinataires qui se chevauchent." }, { status: 409 })
      }
      throw err
    }
  } else {
    updated = await prisma.automationRule.update({ where: { id }, data, include })
  }

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

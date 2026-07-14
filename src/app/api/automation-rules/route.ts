import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { computeNextRunAt, birthdayRecipientsConflict, isBirthdayConflictError, BIRTHDAY_CONFLICT_MESSAGE } from "@/lib/automation"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:          z.string().min(1).max(100),
  templateId:    z.string().min(1),
  triggerType:   z.enum(["SCHEDULED_ONCE", "SCHEDULED_RECURRING", "EVENT_COTISATION_DUE", "EVENT_PAYMENT_OVERDUE", "EVENT_REMINDER", "RSVP_CONFIRMED", "MEMBER_CREATED", "MEMBER_BIRTHDAY"]),
  triggerConfig: z.record(z.string(), z.unknown()),
  recipients:    z.string().default("ALL"),
  channel:       z.enum(["EMAIL", "SMS", "BOTH"]).default("EMAIL"),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const where   = { associationId }
  const orderBy = { createdAt: "desc" as const }
  const include = { template: { select: { name: true, active: true } } }

  if (!searchParams.has("page")) {
    return NextResponse.json(await prisma.automationRule.findMany({ where, orderBy, include }))
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.automationRule.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.automationRule.count({ where }),
  ])
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: ALLOWED_ROLES })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const template = await prisma.messageTemplate.findFirst({
    where: { id: parsed.data.templateId, associationId },
  })
  if (!template) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  const nextRunAt = computeNextRunAt(parsed.data.triggerType, parsed.data.triggerConfig)
  const include   = { template: { select: { name: true, active: true } } }
  const createData: Prisma.AutomationRuleUncheckedCreateInput = {
    name:          parsed.data.name,
    templateId:    parsed.data.templateId,
    triggerType:   parsed.data.triggerType,
    triggerConfig: parsed.data.triggerConfig as Prisma.InputJsonObject,
    recipients:    parsed.data.recipients,
    channel:       parsed.data.channel,
    associationId,
    nextRunAt,
  }

  let rule
  if (parsed.data.triggerType === "MEMBER_BIRTHDAY") {
    // MEMBER_BIRTHDAY has no per-instance config, so an "ALL" rule and a "TYPE:x" rule
    // both active would double-send to every member of that type every year. The check
    // and the insert run in one serializable transaction so two concurrent requests
    // can't both pass the check before either commits.
    try {
      rule = await prisma.$transaction(async tx => {
        const others = await tx.automationRule.findMany({
          where:  { associationId, triggerType: "MEMBER_BIRTHDAY", status: "ACTIVE" },
          select: { recipients: true },
        })
        if (birthdayRecipientsConflict(parsed.data.recipients, others.map(o => o.recipients))) {
          throw new Error(BIRTHDAY_CONFLICT_MESSAGE)
        }
        return tx.automationRule.create({ data: createData, include })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (err) {
      if (isBirthdayConflictError(err)) {
        return NextResponse.json({ error: "Une règle Anniversaire active existe déjà pour des destinataires qui se chevauchent." }, { status: 409 })
      }
      throw err
    }
  } else {
    rule = await prisma.automationRule.create({ data: createData, include })
  }

  await writeActivityLog({ associationId, actorId: userId, action: "RULE_CREATED", entity: "AutomationRule", entityId: rule.id, label: rule.name })
  return NextResponse.json(rule, { status: 201 })
}, { roles: ALLOWED_ROLES })

import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"
import { computeNextRunAt } from "@/lib/automation"
import { writeActivityLog } from "@/lib/activity-log"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:          z.string().min(1).max(100),
  templateId:    z.string().min(1),
  triggerType:   z.enum(["SCHEDULED_ONCE", "SCHEDULED_RECURRING", "EVENT_COTISATION_DUE", "EVENT_PAYMENT_OVERDUE", "EVENT_REMINDER"]),
  triggerConfig: z.record(z.string(), z.unknown()),
  recipients:    z.string().default("ALL"),
})

export async function GET() {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rules = await prisma.automationRule.findMany({
    where:   { associationId: u.associationId },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } } },
  })

  return NextResponse.json(rules)
}

export async function POST(req: Request) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const template = await prisma.messageTemplate.findFirst({
    where: { id: parsed.data.templateId, associationId: u.associationId },
  })
  if (!template) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  const nextRunAt = computeNextRunAt(parsed.data.triggerType, parsed.data.triggerConfig)

  const rule = await prisma.automationRule.create({
    data: {
      name:          parsed.data.name,
      templateId:    parsed.data.templateId,
      triggerType:   parsed.data.triggerType,
      triggerConfig: parsed.data.triggerConfig as Prisma.InputJsonObject,
      recipients:    parsed.data.recipients,
      associationId: u.associationId,
      nextRunAt,
    },
    include: { template: { select: { name: true } } },
  })

  await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "RULE_CREATED", entity: "AutomationRule", entityId: rule.id, label: rule.name })
  return NextResponse.json(rule, { status: 201 })
}

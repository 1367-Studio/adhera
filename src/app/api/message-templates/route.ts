import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { findUnknownVars, TEMPLATE_CATEGORIES } from "@/lib/automation"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:      z.string().min(1).max(100),
  category:  z.enum(TEMPLATE_CATEGORIES).default("GENERAL"),
  subject:   z.string().min(1).max(200),
  body:      z.string().min(1),
  smsBody:   z.string().optional(),
  isDefault: z.boolean().optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const templates = await prisma.messageTemplate.findMany({
    where:   { associationId },
    orderBy: { createdAt: "desc" },
    select:  {
      id: true, name: true, category: true, subject: true, body: true, smsBody: true, active: true, isDefault: true, createdAt: true, updatedAt: true,
      _count: { select: { rules: true } },
      rules:  { where: { status: "ACTIVE" }, select: { id: true } },
    },
  })

  const payload = templates.map(({ rules, ...t }) => ({ ...t, activeRulesCount: rules.length }))
  return NextResponse.json(payload)
}, { roles: ALLOWED_ROLES })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const unknownVars = findUnknownVars([parsed.data.subject, parsed.data.body, parsed.data.smsBody ?? ""].join("\n"))
  if (unknownVars.length > 0) {
    return NextResponse.json(
      { error: `Variable(s) inconnue(s) : ${unknownVars.map(v => `{{${v}}}`).join(", ")}` },
      { status: 422 },
    )
  }

  // Same "at most one default per (associationId, category)" invariant as the PATCH route —
  // unset plus create in one transaction so a concurrent request can't observe (or create)
  // two defaults for the same category in between the two writes. Needs the interactive
  // (callback) transaction form, not the array form — the unset step must exclude the row
  // just created, whose id doesn't exist until the create above it has actually run.
  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.messageTemplate.create({
      data: {
        name:          parsed.data.name,
        category:      parsed.data.category,
        subject:       parsed.data.subject,
        body:          parsed.data.body,
        smsBody:       parsed.data.smsBody || null,
        isDefault:     parsed.data.isDefault ?? false,
        associationId,
      },
    })
    if (parsed.data.isDefault) {
      await tx.messageTemplate.updateMany({
        where: { associationId, category: parsed.data.category, isDefault: true, id: { not: created.id } },
        data:  { isDefault: false },
      })
    }
    return created
  })

  await writeActivityLog({ associationId, actorId: userId, action: "TEMPLATE_CREATED", entity: "MessageTemplate", entityId: template.id, label: template.name })
  return NextResponse.json(template, { status: 201 })
}, { roles: ALLOWED_ROLES })

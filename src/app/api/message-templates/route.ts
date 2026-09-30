import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { findUnknownVars, TEMPLATE_CATEGORIES } from "@/lib/automation"
import { emailBlockSchema, renderBlocksToHtml } from "@/lib/email-blocks"
import { canUseCustomBranding } from "@/lib/plan-limits"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:      z.string().min(1).max(100),
  category:  z.enum(TEMPLATE_CATEGORIES).default("GENERAL"),
  subject:   z.string().min(1).max(200),
  // Design mode (blocks) is the source of truth for `body` when present — see resolvedBody
  // below. Plain-text mode (no blocks) still requires body directly, same as before.
  body:      z.string().optional(),
  blocks:    z.array(emailBlockSchema).max(50).optional(),
  smsBody:   z.string().optional(),
  isDefault: z.boolean().optional(),
}).refine(d => (d.blocks && d.blocks.length > 0) || (d.body && d.body.trim().length > 0), {
  message: "Le contenu de l'email est requis", path: ["body"],
})

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const templates = await prisma.messageTemplate.findMany({
    where:   { associationId },
    orderBy: { createdAt: "desc" },
    select:  {
      id: true, name: true, category: true, subject: true, body: true, blocks: true, smsBody: true, active: true, isDefault: true, createdAt: true, updatedAt: true,
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

  // Same Pro gate as branding settings (logo/color/sender/signature) — the client already
  // disables the "Design visuel" toggle for an unentitled association, this is the actual
  // enforcement. Only checked for a new blocks-mode template: an association that later loses
  // access keeps whatever design-mode templates it already made (same as a downgrade never
  // deleting an already-set logoUrl), it just can't create new ones — see the PATCH route,
  // which intentionally does NOT re-check this on every edit of an existing one.
  if (parsed.data.blocks) {
    const association = await prisma.association.findUnique({ where: { id: associationId }, select: { plan: true, customBrandingEnabled: true } })
    if (!association || !canUseCustomBranding(association)) {
      return NextResponse.json({ error: "Le design visuel est réservé à la formule Pro" }, { status: 403 })
    }
  }

  const resolvedBody = parsed.data.blocks ? renderBlocksToHtml(parsed.data.blocks) : parsed.data.body!

  const unknownVars = findUnknownVars([parsed.data.subject, resolvedBody, parsed.data.smsBody ?? ""].join("\n"))
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
        body:          resolvedBody,
        blocks:        parsed.data.blocks ?? undefined,
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

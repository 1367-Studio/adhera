import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { paperFormTemplateSchema, paperFormTemplateUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { MANAGER_ROLES } from "@/lib/roles"
import {
  PAPER_FORM_TEMPLATE_SELECT,
  UNKNOWN_LEGAL_DOCUMENT_MESSAGE,
  hasUnknownLegalDocument,
  toTemplateResponse,
} from "@/lib/paper-form/templates"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const template = await prisma.paperFormTemplate.findFirst({
    where:  { id, associationId, deletedAt: null },
    select: PAPER_FORM_TEMPLATE_SELECT,
  })

  if (!template) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })
  return NextResponse.json(toTemplateResponse(template))
}, { roles: MANAGER_ROLES })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.paperFormTemplate.findFirst({ where: { id, associationId, deletedAt: null }, select: PAPER_FORM_TEMPLATE_SELECT })
  if (!existing) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = paperFormTemplateUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // The page range of the fields depends on pagesPerForm and either may be the one changing
  // (fewer pages with the old fields, or new fields on a page the old count lacks) — so the
  // merged result is validated as a whole template, not the patch alone.
  const existingResponse = toTemplateResponse(existing)
  const merged = paperFormTemplateSchema.safeParse({
    name:         parsed.data.name         ?? existingResponse.name,
    pagesPerForm: parsed.data.pagesPerForm ?? existingResponse.pagesPerForm,
    fields:       parsed.data.fields       ?? existingResponse.fields,
    // undefined = not in the patch; null is an explicit "clear", so no ?? here.
    identificationText: parsed.data.identificationText !== undefined
      ? parsed.data.identificationText
      : existingResponse.identificationText,
  })
  if (!merged.success) {
    return NextResponse.json({ error: merged.error.issues }, { status: 422 })
  }

  if (parsed.data.fields && await hasUnknownLegalDocument(associationId, merged.data.fields)) {
    return NextResponse.json({ error: UNKNOWN_LEGAL_DOCUMENT_MESSAGE }, { status: 422 })
  }

  const data = {
    ...(parsed.data.name         !== undefined ? { name:         merged.data.name }         : {}),
    ...(parsed.data.pagesPerForm !== undefined ? { pagesPerForm: merged.data.pagesPerForm } : {}),
    ...(parsed.data.fields       !== undefined ? { fields:       merged.data.fields }       : {}),
    ...(parsed.data.identificationText !== undefined ? { identificationText: merged.data.identificationText } : {}),
  }
  if (Object.keys(data).length === 0) return NextResponse.json(existingResponse)

  // Conditional write instead of update({ where: { id } }) — a DELETE landing between the
  // findFirst above and this write would otherwise let the PATCH edit (and log) a template
  // that is already soft-deleted, and still answer 200.
  const { count } = await prisma.paperFormTemplate.updateMany({
    where: { id, associationId, deletedAt: null },
    data,
  })
  if (count === 0) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  const template = await prisma.paperFormTemplate.findFirst({ where: { id, associationId }, select: PAPER_FORM_TEMPLATE_SELECT })
  if (!template) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  // The field list is recorded as a bare marker, same as a document's content: storing the
  // whole mapping twice in every log entry would say little a manager can read.
  const changes: Record<string, { old: string | null; new: string | null }> = {}
  if (template.name !== existing.name) changes.name = { old: existing.name, new: template.name }
  if (template.pagesPerForm !== existing.pagesPerForm) {
    changes.pagesPerForm = { old: String(existing.pagesPerForm), new: String(template.pagesPerForm) }
  }
  if (template.identificationText !== existing.identificationText) {
    changes.identificationText = { old: existing.identificationText, new: template.identificationText }
  }
  if (JSON.stringify(template.fields) !== JSON.stringify(existing.fields)) changes.fields = { old: null, new: null }

  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "PAPER_FORM_TEMPLATE_UPDATED", entity: "PaperFormTemplate", entityId: id, label: template.name, metadata: { changes } })
  }

  return NextResponse.json(toTemplateResponse(template))
}, { roles: MANAGER_ROLES })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.paperFormTemplate.findFirst({ where: { id, associationId, deletedAt: null }, select: { id: true, name: true } })
  if (!existing) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  // Same conditional write as PATCH — of two concurrent DELETEs only one matches the
  // deletedAt: null row, so only one answers 204 and writes the DELETED log entry.
  const { count } = await prisma.paperFormTemplate.updateMany({
    where: { id, associationId, deletedAt: null },
    data:  { deletedAt: new Date() },
  })
  if (count === 0) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  await writeActivityLog({ associationId, actorId: userId, action: "PAPER_FORM_TEMPLATE_DELETED", entity: "PaperFormTemplate", entityId: id, label: existing.name })

  return new NextResponse(null, { status: 204 })
}, { roles: MANAGER_ROLES })

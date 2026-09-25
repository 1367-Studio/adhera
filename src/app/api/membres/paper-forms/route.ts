import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { paperFormTemplateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { MANAGER_ROLES } from "@/lib/roles"
import {
  PAPER_FORM_TEMPLATE_SELECT,
  UNKNOWN_LEGAL_DOCUMENT_MESSAGE,
  hasUnknownLegalDocument,
  toTemplateResponse,
} from "@/lib/paper-form/templates"

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const templates = await prisma.paperFormTemplate.findMany({
    where:   { associationId, deletedAt: null },
    orderBy: { name: "asc" },
    select:  PAPER_FORM_TEMPLATE_SELECT,
  })

  return NextResponse.json(templates.map(toTemplateResponse))
}, { roles: MANAGER_ROLES })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = paperFormTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { name, pagesPerForm, fields, identificationText } = parsed.data
  if (await hasUnknownLegalDocument(associationId, fields)) {
    return NextResponse.json({ error: UNKNOWN_LEGAL_DOCUMENT_MESSAGE }, { status: 422 })
  }

  const template = await prisma.paperFormTemplate.create({
    data:   { associationId, name, pagesPerForm, fields, identificationText },
    select: PAPER_FORM_TEMPLATE_SELECT,
  })

  await writeActivityLog({ associationId, actorId: userId, action: "PAPER_FORM_TEMPLATE_CREATED", entity: "PaperFormTemplate", entityId: template.id, label: template.name })

  return NextResponse.json(toTemplateResponse(template), { status: 201 })
}, { roles: MANAGER_ROLES })

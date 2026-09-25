import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { paperFormCommitRequestSchema, type PaperFormCommitResponse, type PaperFormCommitResult } from "@/lib/schemas"
import { MANAGER_ROLES } from "@/lib/roles"
import { assertMemberLimit, MemberLimitReachedError } from "@/lib/plan-limits"
import { findMembreCreationAssociation } from "@/lib/membres/create-membre"
import { commitPaperForm, resolveTickedDocumentRevisions } from "@/lib/paper-form/commit"
import { UNKNOWN_LEGAL_DOCUMENT_MESSAGE } from "@/lib/paper-form/templates"

// Up to 100 sheets, each in its own transaction, one after the other.
export const maxDuration = 60

// The manager has reviewed the scanned sheets and confirms: creates one member per sheet, the
// student. Answers 200 with one result per sheet, in request order — a sheet that failed does
// not undo the others, the review screen shows which ones to fix and resend.
export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json().catch(() => null)
  const parsed = paperFormCommitRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { templateId, forms } = parsed.data

  const template = await prisma.paperFormTemplate.findFirst({
    where:  { id: templateId, associationId, deletedAt: null },
    select: { id: true },
  })
  if (!template) return NextResponse.json({ error: "Modèle introuvable" }, { status: 404 })

  const { unknownDocument, revisionIdByDocumentId } = await resolveTickedDocumentRevisions(
    associationId,
    forms.flatMap((form) => form.acceptedLegalDocumentIds),
  )
  if (unknownDocument) {
    return NextResponse.json({ error: UNKNOWN_LEGAL_DOCUMENT_MESSAGE }, { status: 422 })
  }

  // Checked once, before anything is written: one member per sheet, the student — parents
  // are written on the student's record, they add nobody.
  try {
    await assertMemberLimit(associationId, forms.length)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    throw err
  }

  const association = await findMembreCreationAssociation(associationId)

  const results: PaperFormCommitResult[] = []
  for (const form of forms) {
    results.push(await commitPaperForm(form, { associationId, actorId: userId, association, revisionIdByDocumentId }))
  }

  const response: PaperFormCommitResponse = { results }
  return NextResponse.json(response)
}, { roles: MANAGER_ROLES })

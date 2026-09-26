import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { TERMS_CONTENT_REQUIRED_CODE, publicFormTerms, type FormTermsAttachment } from "@/lib/form-terms"

// Server-side companions of src/lib/form-terms.ts (kept apart so that file stays importable
// from client components): the shared 400 returned by the save/publish routes, the
// narrowing of the stored `attachments` JSON column, and the effective consent requirement.

export const TERMS_CONTENT_REQUIRED_MESSAGE = "Vous devez remplir le champ « Conditions générales » ou importer un document."

export function termsContentRequiredResponse() {
  return NextResponse.json(
    { error: TERMS_CONTENT_REQUIRED_MESSAGE, code: TERMS_CONTENT_REQUIRED_CODE },
    { status: 400 },
  )
}

// `attachments` is a Json? column — only an array of { url, filename, size } counts as documents.
export function storedTermsAttachments(attachments: Prisma.JsonValue | null | undefined): FormTermsAttachment[] {
  if (!Array.isArray(attachments)) return []
  return attachments.filter((attachment): attachment is FormTermsAttachment =>
    typeof attachment === "object" && attachment !== null && !Array.isArray(attachment)
    && typeof (attachment as Record<string, unknown>).url === "string",
  )
}

// The effective requirement the submission routes enforce, from a stored form/event row —
// consent is only demanded when the public page actually showed something to accept.
export function storedRowRequiresTermsAcceptance(row: {
  conditions:           string | null
  attachments:          Prisma.JsonValue | null
  requireCguvSignature: boolean
}): boolean {
  return publicFormTerms({
    conditions:           row.conditions,
    attachments:          storedTermsAttachments(row.attachments),
    requireCguvSignature: row.requireCguvSignature,
  }).requiresTermsAcceptance
}

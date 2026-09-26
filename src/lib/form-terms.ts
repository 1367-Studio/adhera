import { stripHtml } from "@/lib/utils"

// The form-specific terms shared by donation forms, membership forms and events: a rich-text
// `conditions` field, uploaded `attachments` (PDF), and `requireCguvSignature`. One set of
// rules for every form so the editors, the APIs and the public pages can't disagree.

export type FormTermsAttachment = { url: string; filename: string; size: number }

export type FormTerms = {
  conditions?:          string | null
  attachments?:         FormTermsAttachment[] | null
  requireCguvSignature: boolean
}

// An emptied rich-text editor still stores markup ("<p></p><p></p>", "<p>&nbsp;</p>"):
// that is not text, and must never render as an empty "Conditions" block.
export function hasConditionsText(conditions: string | null | undefined): boolean {
  if (!conditions) return false
  return stripHtml(conditions).replace(/&nbsp;| /g, " ").trim().length > 0
}

export function hasTermsDocument(attachments: FormTermsAttachment[] | null | undefined): boolean {
  return Array.isArray(attachments) && attachments.length > 0
}

export function hasTermsContent(terms: Pick<FormTerms, "conditions" | "attachments">): boolean {
  return hasConditionsText(terms.conditions) || hasTermsDocument(terms.attachments)
}

// The manager may only require acceptance of something that exists — the editors and the
// save/publish routes reject the combination "required + no text + no document".
export function isTermsConfigurationValid(terms: FormTerms): boolean {
  return !terms.requireCguvSignature || hasTermsContent(terms)
}

// What the public form and the checkout routes act on. Forms saved before the rule existed
// can still be "required" with nothing to accept: the checkbox is then hidden and consent
// is not demanded, rather than blocking every visitor on an empty section.
export function publicFormTerms(terms: FormTerms): {
  conditions:              string | null
  attachments:             FormTermsAttachment[]
  requiresTermsAcceptance: boolean
} {
  const conditions  = hasConditionsText(terms.conditions) ? terms.conditions! : null
  const attachments = hasTermsDocument(terms.attachments) ? terms.attachments! : []
  return {
    conditions,
    attachments,
    requiresTermsAcceptance: terms.requireCguvSignature && (conditions !== null || attachments.length > 0),
  }
}

// Stored value for `conditions`: empty editor markup becomes null.
export function normalizeConditions(conditions: string | null | undefined): string | null {
  return hasConditionsText(conditions) ? conditions! : null
}

// Returned by the save/publish routes when the rule is broken; the editors map it to the
// translated "fill in the Conditions field or upload a document" message.
export const TERMS_CONTENT_REQUIRED_CODE = "TERMS_CONTENT_REQUIRED"

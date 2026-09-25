import { prisma } from "@/lib/prisma/client"
import type { PaperFormField, PaperFormTemplateResponse } from "@/lib/schemas"

export const PAPER_FORM_TEMPLATE_SELECT = {
  id:           true,
  name:         true,
  pagesPerForm: true,
  fields:       true,
  identificationText: true,
  createdAt:    true,
  updatedAt:    true,
} as const

type PaperFormTemplateRow = {
  id:           string
  name:         string
  pagesPerForm: number
  fields:       unknown
  identificationText: string | null
  createdAt:    Date
  updatedAt:    Date
}

// `fields` is only ever written after paperFormTemplateSchema accepted it (POST/PATCH), so
// the cast restates what the schema already guaranteed rather than trusting unknown JSON.
export function toTemplateResponse(template: PaperFormTemplateRow): PaperFormTemplateResponse {
  return {
    id:           template.id,
    name:         template.name,
    pagesPerForm: template.pagesPerForm,
    fields:       Array.isArray(template.fields) ? (template.fields as PaperFormField[]) : [],
    identificationText: template.identificationText,
    createdAt:    template.createdAt.toISOString(),
    updatedAt:    template.updatedAt.toISOString(),
  }
}

// A commitment checkbox may only point at a live document of the same association — an id
// from another tenant (or a deleted document) would otherwise record an acceptance of text
// this association never published.
export async function hasUnknownLegalDocument(associationId: string, fields: PaperFormField[]): Promise<boolean> {
  const referencedIds = [...new Set(fields.flatMap((field) => (field.legalDocumentId ? [field.legalDocumentId] : [])))]
  if (referencedIds.length === 0) return false

  const knownCount = await prisma.associationDocument.count({
    where: { id: { in: referencedIds }, associationId, deletedAt: null },
  })
  return knownCount !== referencedIds.length
}

export const UNKNOWN_LEGAL_DOCUMENT_MESSAGE = "Un des documents liés aux cases d'acceptation est introuvable ou a été supprimé"

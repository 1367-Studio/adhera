import { z } from "zod"
import { stripHtml } from "@/lib/utils"

const titleField = z.string().trim()
  .min(1, "Titre requis")
  .max(200, "Titre trop long (max 200 caractères)")

// Raw HTML from the shared Tiptap editor — the length cap applies to the markup itself
// (what is actually stored). Emptiness is no longer checked here: a document may be a PDF
// only, so "has content" is a cross-field rule (see requireContentOrFile below). "" is how a
// file-only document stores its content.
const contentField = z.string()
  .max(200000, "Contenu trop long (max 200 000 caractères)")

// Public R2 URL of an imported PDF. Only its shape is checked here — the routes also check it
// points into the association-documents upload prefix (src/lib/legal/document-file.ts), which
// needs a server-only env var.
const fileUrlField = z.string().trim()
  .url("Lien de fichier invalide")
  .max(2048, "Lien de fichier trop long")
  .nullable()

// The name the manager's file had, only ever displayed — the stored object has a random key.
const fileNameField = z.string().trim()
  .min(1, "Nom de fichier requis")
  .max(255, "Nom de fichier trop long (max 255 caractères)")
  .nullable()

export const CONTENT_OR_FILE_REQUIRED = "Contenu ou fichier PDF requis"

// A document must say something: visible text, a PDF, or both. Checked on the visible text,
// so an editor left with only "<p></p>" and no file is still rejected.
export function hasContentOrFile(document: { content: string; fileUrl: string | null }): boolean {
  return stripHtml(document.content).length > 0 || document.fileUrl !== null
}

export const associationDocumentSchema = z.object({
  title:            titleField,
  content:          contentField,
  fileUrl:          fileUrlField.default(null),
  fileName:         fileNameField.default(null),
  visibleToMembers: z.boolean().default(false),
  // Anyone, with no session — see AssociationDocument in schema.prisma. Both flags default to
  // false so a document is private to the dashboard until it is deliberately shared.
  visibleToPublic:  z.boolean().default(false),
  // Must be agreed to before joining, donating, registering or ordering. The API forces
  // visibleToPublic on alongside it: a checkbox has to link to something a stranger can read.
  requiresAcceptance: z.boolean().default(false),
}).superRefine((document, refinementContext) => {
  // Reported on `content` so the form shows it under the editor, next to the PDF import.
  if (!hasContentOrFile(document)) {
    refinementContext.addIssue({ code: "custom", path: ["content"], message: CONTENT_OR_FILE_REQUIRED })
  }
})

// Rebuilt as its own literal object instead of associationDocumentSchema.partial() — Zod's
// .default() still fires on an omitted field even after .partial(), so a derived schema
// would silently hide the document from members (or un-publish it) on every PATCH that
// doesn't resend the flag.
export const associationDocumentUpdateSchema = z.object({
  title:              titleField.optional(),
  content:            contentField.optional(),
  fileUrl:            fileUrlField.optional(),
  fileName:           fileNameField.optional(),
  visibleToMembers:   z.boolean().optional(),
  visibleToPublic:    z.boolean().optional(),
  requiresAcceptance: z.boolean().optional(),
})
// No content-or-file refine here: a PATCH usually carries only some fields, so the rule can
// only be judged on the merged document — the route does that against the stored row.

export type AssociationDocumentInput       = z.infer<typeof associationDocumentSchema>
export type AssociationDocumentUpdateInput = z.infer<typeof associationDocumentUpdateSchema>

import { z } from "zod"
import { stripHtml } from "@/lib/utils"

const titleField = z.string().trim()
  .min(1, "Titre requis")
  .max(200, "Titre trop long (max 200 caractères)")

// Raw HTML from the shared Tiptap editor — the length cap applies to the markup itself
// (what is actually stored), the emptiness check to the visible text, so an editor left
// with only "<p></p>" is still rejected.
const contentField = z.string()
  .max(200000, "Contenu trop long (max 200 000 caractères)")
  .refine((value) => stripHtml(value).length > 0, "Contenu requis")

export const associationDocumentSchema = z.object({
  title:            titleField,
  content:          contentField,
  visibleToMembers: z.boolean().default(false),
  // Anyone, with no session — see AssociationDocument in schema.prisma. Both flags default to
  // false so a document is private to the dashboard until it is deliberately shared.
  visibleToPublic:  z.boolean().default(false),
  // Must be agreed to before joining, donating, registering or ordering. The API forces
  // visibleToPublic on alongside it: a checkbox has to link to something a stranger can read.
  requiresAcceptance: z.boolean().default(false),
})

// Rebuilt as its own literal object instead of associationDocumentSchema.partial() — Zod's
// .default() still fires on an omitted field even after .partial(), so a derived schema
// would silently hide the document from members (or un-publish it) on every PATCH that
// doesn't resend the flag.
export const associationDocumentUpdateSchema = z.object({
  title:              titleField.optional(),
  content:            contentField.optional(),
  visibleToMembers:   z.boolean().optional(),
  visibleToPublic:    z.boolean().optional(),
  requiresAcceptance: z.boolean().optional(),
})

export type AssociationDocumentInput       = z.infer<typeof associationDocumentSchema>
export type AssociationDocumentUpdateInput = z.infer<typeof associationDocumentUpdateSchema>

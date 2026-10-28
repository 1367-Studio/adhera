import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { MAX_SITE_DRAFT_BYTES, puckBlockSchema } from "@/lib/site-puck/site-draft-schema"

// FORM-7 custom pages: the request bodies accepted by /api/site-pages (create/save) and
// /api/site-pages/[id]/publish. A page's stored content is Puck's {content, zones} only — no
// `root` (header/footer/theme stay the single site-wide root, see SitePage in schema.prisma).

const MAX_TOP_LEVEL_BLOCKS = 200
const MAX_TITLE_LENGTH     = 120

// First path segments already used by a hand-built `src/app/[slug]/*` route, plus a few
// platform-reserved words — a custom page must never shadow any of them.
export const RESERVED_SITE_PAGE_SLUGS: readonly string[] = [
  "actualites", "evenements", "boutique", "adhesion", "dons", "documents", "complete-adhesion",
  "dashboard", "portal", "api", "app", "site", "apercu",
]

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const sitePageSlugSchema = z.string()
  .trim()
  .min(1, "L'adresse de la page est obligatoire")
  .max(80, "L'adresse de la page est trop longue")
  .regex(SLUG_PATTERN, "L'adresse ne peut contenir que des lettres minuscules, des chiffres et des tirets")
  .refine(slug => !RESERVED_SITE_PAGE_SLUGS.includes(slug), { message: "Cette adresse est réservée, choisissez-en une autre" })

export const sitePageTitleSchema = z.string().trim().min(1, "Le titre est obligatoire").max(MAX_TITLE_LENGTH)

export const sitePageContentSchema = z.object({
  content: z.array(puckBlockSchema).max(MAX_TOP_LEVEL_BLOCKS),
  zones:   z.record(z.string(), z.array(puckBlockSchema)).optional(),
}).passthrough()

export type SitePageContent = z.infer<typeof sitePageContentSchema>

export const createSitePageSchema = z.object({
  title: sitePageTitleSchema,
  slug:  sitePageSlugSchema,
})

export const updateSitePageSchema = z.object({
  title:          sitePageTitleSchema.optional(),
  seoTitle:       z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(300).optional().nullable(),
  showInNav:      z.boolean().optional(),
  navLabel:       z.string().trim().max(60).optional().nullable(),
  navPosition:    z.number().int().optional(),
  // null: its own header button, like the existing headerLinks. A SiteNavMenu id: grouped
  // inside that named dropdown instead — the association's choice per page.
  navMenuId:      z.string().min(1).optional().nullable(),
  content:        z.array(puckBlockSchema).max(MAX_TOP_LEVEL_BLOCKS).optional(),
  zones:          z.record(z.string(), z.array(puckBlockSchema)).optional(),
})

type ParsedJsonBody<T> =
  | { success: true; data: T }
  | { success: false; errorResponse: NextResponse }

async function parseJsonBody<Schema extends z.ZodTypeAny>(
  req: Request,
  schema: Schema,
  invalidBodyMessage = "Corps de requête invalide",
  invalidFormatMessage = "Format invalide",
): Promise<ParsedJsonBody<z.infer<Schema>>> {
  const rawBody = await req.text()
  if (rawBody.length > MAX_SITE_DRAFT_BYTES) {
    return {
      success:       false,
      errorResponse: NextResponse.json({ error: "La page est trop volumineuse pour être enregistrée." }, { status: 413 }),
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawBody)
  } catch {
    return { success: false, errorResponse: NextResponse.json({ error: invalidBodyMessage }, { status: 400 }) }
  }

  const parsedBody = schema.safeParse(parsedJson)
  if (!parsedBody.success) {
    const firstIssue = parsedBody.error.issues[0]?.message ?? invalidFormatMessage
    return { success: false, errorResponse: NextResponse.json({ error: firstIssue }, { status: 422 }) }
  }
  return { success: true, data: parsedBody.data }
}

/** Reads and validates a page-creation request body (title + slug). */
export function parseCreateSitePageRequest(req: Request) {
  return parseJsonBody(req, createSitePageSchema, "Corps de requête invalide", "Titre ou adresse invalide")
}

/** Reads and validates a draft-save request body (content/zones + the editable page fields). */
export function parseUpdateSitePageRequest(req: Request) {
  return parseJsonBody(req, updateSitePageSchema, "Corps de requête invalide", "Format de page invalide")
}

/** Reads and validates a publish request body: the page's current {content, zones}. */
export async function parsePublishSitePageRequest(req: Request): Promise<ParsedJsonBody<Prisma.InputJsonValue>> {
  const parsed = await parseJsonBody(req, sitePageContentSchema, "Corps de requête invalide", "Format de page invalide")
  if (!parsed.success) return parsed
  return { success: true, data: parsed.data as Prisma.InputJsonValue }
}

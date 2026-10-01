import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

// FORM-7: the Puck page body accepted by PUT /api/site-draft (save) and
// POST /api/site-draft/publish — one definition so a page that saves can always be published.

// A generous cap for one page of blocks (text, image URLs — never the images themselves).
export const MAX_SITE_DRAFT_BYTES = 1_000_000
const MAX_TOP_LEVEL_BLOCKS = 200

// Puck Data's outer shape only: block props are free-form per block type and are rendered
// through React (escaped), so they are not validated field by field here.
const puckBlockSchema = z.object({
  type:  z.string().min(1).max(64),
  props: z.record(z.string(), z.unknown()),
}).passthrough()

export const siteDraftSchema = z.object({
  root:    z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  content: z.array(puckBlockSchema).max(MAX_TOP_LEVEL_BLOCKS),
  zones:   z.record(z.string(), z.array(puckBlockSchema)).optional(),
}).passthrough()

type ParsedSiteDraft =
  | { success: true; siteDraft: Prisma.InputJsonValue }
  | { success: false; errorResponse: NextResponse }

/** Reads and validates a Puck page from the request body (size cap, JSON, outer shape). */
export async function parseSiteDraftRequest(req: Request): Promise<ParsedSiteDraft> {
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
    return { success: false, errorResponse: NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 }) }
  }

  const parsedDraft = siteDraftSchema.safeParse(parsedJson)
  if (!parsedDraft.success) {
    return { success: false, errorResponse: NextResponse.json({ error: "Format de page invalide" }, { status: 422 }) }
  }
  return { success: true, siteDraft: parsedDraft.data as Prisma.InputJsonValue }
}

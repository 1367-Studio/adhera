import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

// FORM-7 website builder: the Puck page being edited (Association.siteDraft). A draft only —
// the public site still renders siteConfig, so saving here never changes what visitors see.

const SITE_EDITOR_ROLES = ["ADMIN", "PRESIDENT"]

// A generous cap for one page of blocks (text, image URLs — never the images themselves).
const MAX_DRAFT_BYTES = 1_000_000
const MAX_TOP_LEVEL_BLOCKS = 200

// Puck Data's outer shape only: block props are free-form per block type and are rendered
// through React (escaped), so they are not validated field by field here.
const puckBlockSchema = z.object({
  type:  z.string().min(1).max(64),
  props: z.record(z.string(), z.unknown()),
}).passthrough()

const siteDraftSchema = z.object({
  root:    z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  content: z.array(puckBlockSchema).max(MAX_TOP_LEVEL_BLOCKS),
  zones:   z.record(z.string(), z.array(puckBlockSchema)).optional(),
}).passthrough()

export const GET = withAdminAuth(async (_req, ctx) => {
  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { siteDraft: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ draft: association.siteDraft ?? null })
}, { roles: SITE_EDITOR_ROLES, module: "site" })

export const PUT = withAdminAuth(async (req, ctx) => {
  const rawBody = await req.text()
  if (rawBody.length > MAX_DRAFT_BYTES) {
    return NextResponse.json({ error: "La page est trop volumineuse pour être enregistrée." }, { status: 413 })
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 })
  }

  const parsedDraft = siteDraftSchema.safeParse(parsedJson)
  if (!parsedDraft.success) {
    return NextResponse.json({ error: "Format de page invalide" }, { status: 422 })
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { siteDraft: parsedDraft.data as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() })
}, { roles: SITE_EDITOR_ROLES, module: "site" })

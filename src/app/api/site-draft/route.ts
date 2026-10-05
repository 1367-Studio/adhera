import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { parseSiteDraftRequest } from "@/lib/site-puck/site-draft-schema"

// FORM-7 website builder: the Puck page being edited (Association.siteDraft). A draft only —
// visitors see sitePuckPublished (POST /api/site-draft/publish) when siteBuilder is PUCK, so
// saving here never changes what they see. Saving never releases form bindings either: a
// block removed from a work-in-progress draft may come back before the next publish.

export const GET = withAdminAuth(async (_req, ctx) => {
  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { siteDraft: true, sitePuckPublishedAt: true, siteBuilder: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({
    draft:       association.siteDraft ?? null,
    publishedAt: association.sitePuckPublishedAt?.toISOString() ?? null,
    siteBuilder: association.siteBuilder,
  })
// Readable by every dashboard role that can open /dashboard/site (like GET /api/site-config):
// the switch bar shows which version is live, read-only for non-editors. Writing needs
// "site" edit (PUT here, publish, /api/site-builder).
}, { module: "site" })

export const PUT = withAdminAuth(async (req, ctx) => {
  const parsedDraft = await parseSiteDraftRequest(req)
  if (!parsedDraft.success) return parsedDraft.errorResponse

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { siteDraft: parsedDraft.siteDraft },
  })
  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() })
}, { area: "site", module: "site" })

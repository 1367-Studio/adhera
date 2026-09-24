import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

// One published legal document, readable with no session — see ../route.ts for why this is
// not gated on sitePublished or the `site` module.
//
// The content is served exactly as the association wrote it, with NO machine translation,
// unlike the actualites and evenements public routes. A legal text is accepted as it stands:
// serving an automatic translation of terms someone then agrees to would mean they accepted
// wording the association never approved.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, siteConfig: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const site = { name: assoc.name, config: assoc.siteConfig }

  // Missing, soft-deleted, not-published and another association's documents all answer the
  // same 404 — the same non-disclosure rule as the portal route. `site` rides along so a
  // stale link still renders the association's nav/footer around the "not found" state
  // instead of stranding the visitor on a bare page.
  const document = await prisma.associationDocument.findFirst({
    where:  { id, associationId: assoc.id, deletedAt: null, visibleToPublic: true },
    select: { id: true, title: true, content: true, fileUrl: true, fileName: true, updatedAt: true },
  })
  if (!document) return NextResponse.json({ error: "Not found", site }, { status: 404 })

  return NextResponse.json({ document, site })
}

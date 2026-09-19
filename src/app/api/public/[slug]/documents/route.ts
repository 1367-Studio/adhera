import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

// The association's own legal documents it chose to publish — no session, no account.
//
// Deliberately NOT gated on `sitePublished` or the `site` module, unlike the actualites
// routes: the public adhesion/dons/evenements/boutique forms aren't gated on them either, so
// gating here would break the "read the terms" link for any association that collects
// memberships without running a public site. `visibleToPublic` is the only gate — the
// manager's own decision to publish is what makes a document readable.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, siteConfig: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const documents = await prisma.associationDocument.findMany({
    where:   { associationId: assoc.id, deletedAt: null, visibleToPublic: true },
    orderBy: { title: "asc" },
    // Never `content` here: the list only renders one row per document, and a document's HTML
    // runs to 200 000 characters.
    select:  { id: true, title: true, updatedAt: true },
  })

  // `site` lets the page draw the association's nav/footer around the list — sent even when
  // there are no documents, same convention as the actualites public route.
  return NextResponse.json({ documents, site: { name: assoc.name, config: assoc.siteConfig } })
}

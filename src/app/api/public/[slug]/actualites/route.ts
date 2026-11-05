import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { translateFields } from "@/lib/i18n/translate"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { translateSiteUiStrings } from "@/lib/site-puck/site-ui-strings-translate"

// The "Voir tout" destination for the site's Actualités block — same gating, ordering and
// recipient filter as the homepage's own list (src/app/[slug]/page.tsx) and the detail route,
// so the full list is never out of step with the section a visitor clicked through from.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, sitePublished: true, siteConfig: true, modules: true },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.actualites) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Sent back even when the association has published nothing, so the client can still render
  // the site's nav/footer around the empty state — same convention as the documents list route.
  const site = { name: assoc.name, config: assoc.siteConfig }

  const actualites = await prisma.actualite.findMany({
    where: {
      associationId: assoc.id,
      publishedAt:   { not: null, lte: new Date() },
      // Anonymous visitors can never be an authorized SELECTED recipient — same gate as the
      // homepage list and the detail route.
      recipientMode: "ALL",
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    select:  { id: true, title: true, content: true, imageUrl: true, pinned: true, publishedAt: true },
  })

  // The admin always writes this content in their own language — translateFields translates it
  // automatically whenever the visitor's resolved locale isn't French (no-ops for French),
  // same always-on-by-locale policy as the homepage's own list and the detail route.
  const locale = await resolvePublicLocale()
  const [translated, ui] = await Promise.all([
    translateFields(
      actualites.map(a => ({ title: a.title, content: a.content })),
      ["title", "content"],
      locale,
      assoc.id,
    ),
    // Fixed UI chrome for this page (empty-state message, "back to site", etc.) — same dynamic
    // on-demand pipeline as every other site-wide label, see site-ui-strings.ts.
    translateSiteUiStrings(locale, assoc.id),
  ])

  return NextResponse.json({
    actualites: actualites.map((a, i) => ({ ...a, title: translated[i].title, content: translated[i].content })),
    site,
    ui,
  })
}

import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { translateFields } from "@/lib/i18n/translate"
import { wantsContentTranslation } from "@/lib/i18n/public-locale"
import type { Locale } from "@/i18n/locales"

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

  // The admin always writes this content in their own language — only translate it when the
  // visitor explicitly clicked "Traduire cette page" (PublicSiteLocaleSwitcher), same opt-in
  // gate as the homepage's own list and the detail route; otherwise the original text is sent.
  const locale = (await getLocale()) as Locale
  const shouldTranslate = wantsContentTranslation(new URL(req.url).searchParams.get("translate"), locale)
  const translated = shouldTranslate
    ? await translateFields(
        actualites.map(a => ({ title: a.title, content: a.content })),
        ["title", "content"],
        locale,
        assoc.id,
      )
    : actualites.map(a => ({ title: a.title, content: a.content }))

  return NextResponse.json({
    actualites: actualites.map((a, i) => ({ ...a, title: translated[i].title, content: translated[i].content })),
    site,
  })
}

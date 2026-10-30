import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma/client"
import { SitePuckPublicPage } from "@/components/site/puck/site-puck-public-page"
import type { SitePuckData } from "@/lib/site-puck/site-puck-data"
import type { SitePuckMetadata } from "@/components/site/blocks/site-block-types"
import { readPublishedPuckData } from "@/lib/site-puck/site-puck-published"
import {
  getSiteData, translateListings, livePuckPage, buildSitePuckMetadata, sitePuckPageMetadata,
} from "@/lib/site-puck/site-public-data"
import { translateSitePuckData, translateSitePuckSeo } from "@/lib/site-puck/site-puck-translate"
import { translateSiteUiStrings } from "@/lib/site-puck/site-ui-strings-translate"
import { resolvePublicLocale, wantsContentTranslation } from "@/lib/i18n/public-locale"

// FORM-7 custom pages: one more page on the new builder's site, reachable at
// /{slug}/{pageSlug}. A sibling of the hand-built sub-routes (actualites/[id], evenements/[id],
// etc.) — the reserved-word list in site-page-schema.ts keeps a custom page's slug from ever
// shadowing one of them. Draft pages 404 here exactly like an unknown slug: only a PUBLISHED
// SitePage is ever looked up. There is no legacy-builder equivalent for a custom page (the new
// builder is the only place they can be created), so unlike the home page there is no "old
// builder" fallback to render — only the home page's live chrome (header/footer/theme) is
// borrowed, never its content.

type RouteParams = { slug: string; pageSlug: string }

async function getPublishedSitePage(associationId: string, pageSlug: string) {
  return prisma.sitePage.findFirst({
    where:  { associationId, slug: pageSlug, status: "PUBLISHED" },
    select: { title: true, seoTitle: true, seoDescription: true, publishedContent: true },
  })
}

// Combines the home page's live chrome (header/footer/theme — the single site-wide root) with
// this page's own published blocks, then re-validates the result exactly like a stored page:
// a custom page can never render with a malformed/missing root or content.
function buildCustomPageData(homePage: SitePuckData, publishedContent: unknown): SitePuckData | null {
  if (typeof publishedContent !== "object" || publishedContent === null) return null
  const { content, zones } = publishedContent as { content?: unknown; zones?: unknown }
  return readPublishedPuckData({ root: homePage.root, content, zones })
}

export async function generateMetadata(
  { params }: { params: Promise<RouteParams> },
): Promise<Metadata> {
  const { slug, pageSlug } = await params
  const data = await getSiteData(slug)
  if (!data) return { title: "Page introuvable" }
  const homePage = livePuckPage(data)
  if (!homePage) return { title: data.name }
  const sitePage = await getPublishedSitePage(data.id, pageSlug)
  if (!sitePage) return { title: data.name }

  try {
    // Deliberately not gated behind the visitor's "Traduire cette page" click (see
    // wantsContentTranslation) — crawlers and link-preview bots never click anything, and a
    // <title>/description always in French for them would defeat having a translated site.
    const locale        = await resolvePublicLocale()
    const translatedRoot = await translateSitePuckSeo(homePage, locale, data.id)
    return sitePuckPageMetadata(data, translatedRoot, `/${data.slug}/${pageSlug}`, {
      title:       sitePage.seoTitle,
      description: sitePage.seoDescription,
    })
  } catch (metadataError) {
    console.error("[public-site] custom page metadata failed", metadataError)
    return { title: sitePage.title }
  }
}

export default async function PublicSiteCustomPage(
  { params, searchParams }: { params: Promise<RouteParams>; searchParams: Promise<{ translate?: string }> },
) {
  const { slug, pageSlug } = await params
  const { translate }      = await searchParams
  const rawData = await getSiteData(slug)
  if (!rawData) notFound()

  // Custom pages only make sense once the new builder is actually live — there is no legacy
  // rendering path for them (see the comment at the top of this file).
  const homePage = livePuckPage(rawData)
  if (!homePage) notFound()

  const sitePage = await getPublishedSitePage(rawData.id, pageSlug)
  if (!sitePage) notFound()

  const pageData = buildCustomPageData(homePage, sitePage.publishedContent)
  if (!pageData) notFound()

  const locale = await resolvePublicLocale()
  // Association-authored content only translates on the visitor's explicit "Traduire cette
  // page" click — same gate as src/app/[slug]/page.tsx, see wantsContentTranslation.
  const shouldTranslate = wantsContentTranslation(translate, locale)
  const data = shouldTranslate ? await translateListings(rawData, locale) : rawData

  let translatedPage: SitePuckData | null = null
  let metadata: SitePuckMetadata | null = null
  try {
    const [translated, ui] = await Promise.all([
      shouldTranslate ? translateSitePuckData(pageData, locale, data.id) : Promise.resolve(pageData),
      translateSiteUiStrings(locale, data.id),
    ])
    translatedPage = translated
    metadata       = buildSitePuckMetadata(data, translatedPage, locale, ui)
  } catch (metadataError) {
    console.error("[public-site] custom page data failed", metadataError)
  }

  if (!metadata || !translatedPage) notFound()

  return (
    <SitePuckPublicPage
      publishedData={translatedPage}
      metadata={metadata}
      legacyFallback={<CustomPageUnavailable />}
    />
  )
}

function CustomPageUnavailable() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-lg font-medium text-gray-900">Page indisponible</p>
      <p className="text-sm text-gray-500">Cette page ne peut pas être affichée pour le moment.</p>
    </div>
  )
}

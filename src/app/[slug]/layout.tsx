import type { ReactNode } from "react"
import { prisma } from "@/lib/prisma/client"
import { SITE_FONTS, SITE_DEFAULT_FONT, isSiteFontKey } from "@/lib/site-fonts"
import { SitePuckChromeProvider } from "@/components/site/site-puck-chrome-context"
import { publishedRootProps, readPublishedPuckData } from "@/lib/site-puck/site-puck-published"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { translateSiteUiStrings } from "@/lib/site-puck/site-ui-strings-translate"
import type { SitePuckRootProps } from "@/lib/site-puck/site-puck-data"
import type { SiteConfig } from "@/types/site-config"

// Root settings of the new builder's published page, when the public site runs on it (FORM-7).
// Same validation as [slug]/page.tsx, so the homepage and the sub-pages always agree on which
// builder is live; anything unexpected falls back to the old builder (null).
function livePuckRootProps(siteBuilder: string | undefined, sitePuckPublished: unknown): SitePuckRootProps | null {
  if (siteBuilder !== "PUCK") return null
  try {
    const publishedData = readPublishedPuckData(sitePuckPublished)
    return publishedData ? publishedRootProps(publishedData) : null
  } catch {
    return null
  }
}

// Shared by every /[slug]/** route (homepage, evenements/[id], boutique/*, adhesion/*,
// dons/*, actualites/[id]) — the one place the association's chosen site font applies, so a
// visitor lands on the same typography whichever public page they open first. Deliberately
// does no 404/publish gating itself: each page already owns that logic (see [slug]/page.tsx's
// getSiteData), and an invalid slug here just falls through to the default font while the
// page underneath renders its own not-found state.
export default async function SiteLayout(
  { children, params }: { children: ReactNode; params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, siteConfig: true, siteBuilder: true, sitePuckPublished: true },
  })
  const config = assoc?.siteConfig as SiteConfig | null
  const puckRootProps = livePuckRootProps(assoc?.siteBuilder, assoc?.sitePuckPublished)
  // The new builder never writes siteConfig: its font lives in the published page.
  const requestedFont = puckRootProps ? puckRootProps.fontFamily : config?.fontFamily
  const fontKey = isSiteFontKey(requestedFont) ? requestedFont : SITE_DEFAULT_FONT
  const font = SITE_FONTS[fontKey]

  const content = (
    <div className={font.variable} style={{ fontFamily: font.cssVar }}>
      {children}
    </div>
  )

  // Old builder: no provider at all, so its pages render exactly as before.
  if (!puckRootProps) return content

  const locale = await resolvePublicLocale()
  const ui     = await translateSiteUiStrings(locale, assoc!.id)
  return (
    <SitePuckChromeProvider value={{ rootProps: puckRootProps, locale, ui }}>
      {content}
    </SitePuckChromeProvider>
  )
}

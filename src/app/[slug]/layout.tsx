import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { prisma } from "@/lib/prisma/client"
import { SITE_FONTS, SITE_DEFAULT_FONT, isSiteFontKey } from "@/lib/site-fonts"
import { SitePuckChromeProvider } from "@/components/site/site-puck-chrome-context"
import { publishedRootProps, readPublishedPuckData } from "@/lib/site-puck/site-puck-published"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { loadMessagesForLocale } from "@/i18n/request"
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
//
// Also the one place that overrides next-intl's locale for this entire subtree: every public
// page (old or new builder, including dons/adhesion/evenements/boutique) renders under this
// visitor's own SITE_LOCALE choice, never the portal's NEXT_LOCALE that the root layout's own
// NextIntlClientProvider uses — see src/lib/i18n/public-locale.ts for why those stay separate.
// Without this, a public page's useTranslations()/useLocale() calls (form labels, buttons)
// would silently follow a different cookie than the admin-authored content on the same page
// (translateFields, resolved via resolvePublicLocale() in each API route).
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

  const locale   = await resolvePublicLocale()
  const messages = await loadMessagesForLocale(locale)
  // Only the new builder's chrome (SitePublicChrome) needs the translated UI-string dictionary
  // — same puckRootProps gate as before, just no longer also gating the locale/messages above.
  const ui = puckRootProps ? await translateSiteUiStrings(locale, assoc!.id) : null

  const content = (
    <div className={font.variable} style={{ fontFamily: font.cssVar }}>
      {puckRootProps && ui
        ? (
          <SitePuckChromeProvider value={{ rootProps: puckRootProps, locale, ui }}>
            {children}
          </SitePuckChromeProvider>
        )
        : children}
    </div>
  )

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {content}
    </NextIntlClientProvider>
  )
}

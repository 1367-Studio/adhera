import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { SiteSection } from "@/types/site-config"
import { SiteHeroSection }        from "@/components/site/sections/site-hero-section"
import { SiteAboutSection }       from "@/components/site/sections/site-about-section"
import { SiteEventsSection }      from "@/components/site/sections/site-events-section"
import { SiteActualitesSection }  from "@/components/site/sections/site-actualites-section"
import { SiteMembershipSection }  from "@/components/site/sections/site-membership-section"
import { SiteDonsSection }        from "@/components/site/sections/site-dons-section"
import { SiteBoutiqueSection }    from "@/components/site/sections/site-boutique-section"
import { SiteContactSection }     from "@/components/site/sections/site-contact-section"
import { SiteNavbar }             from "@/components/site/site-navbar"
import { SiteFooter }             from "@/components/site/site-footer"
import { getSiteColorVars }       from "@/lib/site-theme"
import { SitePuckPublicPage }     from "@/components/site/puck/site-puck-public-page"
import type { SitePuckMetadata }  from "@/components/site/blocks/site-block-types"
import type { SitePuckData }      from "@/lib/site-puck/site-puck-data"
import {
  getSiteData, translateListings, livePuckPage, buildSitePuckMetadata, sitePuckPageMetadata, type SiteData,
} from "@/lib/site-puck/site-public-data"
import { translateSitePuckData, translateSitePuckSeo } from "@/lib/site-puck/site-puck-translate"
import { translateSiteUiStrings } from "@/lib/site-puck/site-ui-strings-translate"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const data = await getSiteData(slug)
  if (!data) return { title: "Association introuvable" }
  const publishedData = livePuckPage(data)
  if (publishedData) {
    try {
      const locale        = await resolvePublicLocale()
      const translatedPage = await translateSitePuckSeo(publishedData, locale, data.id)
      return sitePuckPageMetadata(data, translatedPage, `/${data.slug}`)
    } catch (metadataError) {
      console.error("[public-site] new builder metadata failed, using the old builder's", metadataError)
    }
  }
  return { title: data.name, description: `Site officiel de ${data.name}` }
}

export default async function PublicSitePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const rawData = await getSiteData(slug)
  if (!rawData) notFound()

  const locale = await resolvePublicLocale()
  const data   = await translateListings(rawData, locale)

  const legacyPage = renderLegacySitePage(data, slug)

  // New builder (FORM-7), only when it is the live version and its page is valid. The old
  // builder's page is handed along as the fallback for any failure while rendering it.
  const publishedData = livePuckPage(data)
  if (publishedData) {
    let translatedPage: SitePuckData | null = null
    let metadata: SitePuckMetadata | null = null
    try {
      const [translated, ui] = await Promise.all([
        translateSitePuckData(publishedData, locale, data.id),
        translateSiteUiStrings(locale, data.id),
      ])
      translatedPage = translated
      metadata       = buildSitePuckMetadata(data, translatedPage, locale, ui)
    } catch (metadataError) {
      console.error("[public-site] new builder data failed, showing the old builder's page", metadataError)
    }
    if (metadata && translatedPage) {
      return <SitePuckPublicPage publishedData={translatedPage} metadata={metadata} legacyFallback={legacyPage} />
    }
  }

  return legacyPage
}

// The old builder's page (siteConfig sections) — what every association on the old builder sees.
function renderLegacySitePage(data: SiteData, slug: string) {
  const config   = data.config
  const sections = config?.sections ?? []
  const color    = "var(--site-primary)"

  return (
    <div
      className="min-h-screen flex flex-col bg-white text-gray-900"
      style={{ colorScheme: "light", ...getSiteColorVars(config) }}
    >
      <SiteNavbar
        name={data.name}
        logoUrl={config?.logoUrl}
        color={color}
        secondaryColor="var(--site-secondary)"
        portalSlug={slug}
        headerBgColor={config?.headerBgColor}
        headerShowMembres={config?.headerShowMembres}
        headerShowRegister={config?.headerShowRegister}
        membershipCta={data.membershipCta}
      />

      <main className="flex-1">
        {sections.map((section: SiteSection) => {
          switch (section.type) {
            case "hero":
              return <SiteHeroSection key={section.id} section={section} color={color} />
            case "about":
              return <SiteAboutSection key={section.id} section={section} />
            case "events":
              return <SiteEventsSection key={section.id} section={section} events={data.events} color={color} slug={slug} />
            case "actualites":
              return <SiteActualitesSection key={section.id} section={section} actualites={data.actualites} color={color} slug={slug} />
            case "membership":
              return (
                <SiteMembershipSection
                  key={section.id} section={section} slug={slug} color={color}
                  membershipForm={data.membershipFormBySection[section.id] ?? null}
                />
              )
            case "dons":
              return data.donsEnabled
                ? (
                  <SiteDonsSection
                    key={section.id} section={section} slug={slug} color={color}
                    canIssueTaxReceipts={data.canIssueTaxReceipts}
                    donationForm={data.donationFormBySection[section.id] ?? null}
                    usesDonationForms={data.usesDonationForms}
                  />
                )
                : null
            case "boutique":
              return data.boutiqueEnabled
                ? <SiteBoutiqueSection key={section.id} section={section} produits={data.boutiqueProduits} color={color} slug={slug} />
                : null
            case "contact":
              return <SiteContactSection key={section.id} section={section} city={data.city} country={data.country} />
          }
        })}

        {sections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 text-center px-4">
            <h1 className="text-4xl font-bold mb-4">{data.name}</h1>
            {data.city && <p className="text-gray-500">{data.city}, {data.country}</p>}
          </div>
        )}
      </main>

      <SiteFooter
        name={data.name}
        footerText={config?.footerText}
        footerBgColor={config?.footerBgColor}
        footerLinks={config?.footerLinks}
        color={color}
      />
    </div>
  )
}

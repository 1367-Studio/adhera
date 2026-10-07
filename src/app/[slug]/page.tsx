import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { SiteConfig, SiteSection } from "@/types/site-config"
import { evenementNotOverWhere } from "@/lib/evenement-timing"
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
import { prisma }                 from "@/lib/prisma/client"
import { parseModules }           from "@/lib/modules"
import { getSiteColorVars }       from "@/lib/site-theme"
import { APP_URL }                from "@/lib/env"
import { SitePuckPublicPage }     from "@/components/site/puck/site-puck-public-page"
import type { SitePuckMetadata }  from "@/components/site/blocks/site-block-types"
import type { SitePuckData }      from "@/lib/site-puck/site-puck-data"
import { publishedRootProps, readPublishedPuckData } from "@/lib/site-puck/site-puck-published"
import { listPuckBlocksOfType, puckBlockId } from "@/lib/site-puck/site-puck-tree"
import { translateSitePuckData, translateSitePuckSeo } from "@/lib/site-puck/site-puck-translate"
import type { SiteUiStrings } from "@/lib/site-puck/site-ui-strings"
import { translateSiteUiStrings } from "@/lib/site-puck/site-ui-strings-translate"
import { translateFields } from "@/lib/i18n/translate"
import { resolvePublicLocale } from "@/lib/i18n/public-locale"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"

type PublicEvent = {
  id: string; title: string; date: string; endDate: string | null
  location: string | null; description: string | null; price: string | null; capacity: number | null
  ticketTypes: { id: string; label: string; price: string; remaining: number | null; full: boolean }[]
}

type PublicActualite = {
  id: string; title: string; content: string; imageUrl: string | null
  pinned: boolean; publishedAt: string
}

type PublicBoutiqueProduit = {
  id: string; name: string; imageUrl: string | null
  variantes: { price: number }[]
}

async function getSiteData(slug: string) {
  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      id: true, name: true, slug: true, city: true, country: true,
      sitePublished: true, siteConfig: true, modules: true, canIssueTaxReceipts: true,
      // New builder (FORM-7): which version is live, the published page, and the contact
      // details its Contact block shows.
      siteBuilder: true, sitePuckPublished: true,
      address: true, phone: true, contactEmail: true, website: true,
    },
  })

  if (!assoc || !assoc.sitePublished) return null
  const mods = parseModules(assoc.modules)
  if (!mods.site) return null

  const now = new Date()
  const [events, actualites, boutiqueProduits] = await Promise.all([
    mods.evenements
      ? prisma.evenement.findMany({
          where:   { association: { slug }, status: "PUBLISHED", visibility: { not: "PRIVATE" }, ...evenementNotOverWhere(now) },
          orderBy: { date: "asc" },
          take:    20,
          // Une tarif désactivée n'est plus achetable — même filtre que le formulaire public
          // (realTicketTypes dans inscription/route.ts), pour ne jamais annoncer un prix que
          // personne ne peut plus obtenir.
          select:  { id: true, slug: true, title: true, date: true, endDate: true, location: true, description: true, imageUrl: true, price: true, capacity: true, ticketTypes: { where: { active: true }, orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true } } },
        })
      : Promise.resolve([]),
    mods.actualites
      ? prisma.actualite.findMany({
          // Anonymous visitors can never be an authorized SELECTED recipient — only ALL-audience posts are public.
          where:   { association: { slug }, publishedAt: { not: null, lte: now }, recipientMode: "ALL" },
          orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
          take:    20,
          select:  { id: true, title: true, content: true, imageUrl: true, pinned: true, publishedAt: true },
        })
      : Promise.resolve([]),
    mods.boutique
      ? prisma.boutiqueProduit.findMany({
          where:   { association: { slug }, status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take:    20,
          select:  { id: true, name: true, imageUrl: true, variantes: { select: { price: true } } },
        })
      : Promise.resolve([]),
  ])

  const cappedTicketTypeIds = events.flatMap(e => e.ticketTypes).filter(tt => tt.capacity != null).map(tt => tt.id)
  const occupancy = cappedTicketTypeIds.length
    ? await prisma.participation.groupBy({
        by:     ["ticketTypeId"],
        where:  { ticketTypeId: { in: cappedTicketTypeIds }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        _count: { _all: true },
      })
    : []
  const occupiedMap = new Map(occupancy.map(o => [o.ticketTypeId, o._count._all]))

  // Each MembershipForm explicitly targets one "membership" SiteSection (siteSectionId, set
  // in the form's Publication step) — mirrors AssoConnect's own form→page picker — so
  // multiple published forms can coexist, one per section, with no ambiguous "most recently
  // touched" arbitration. A section with nothing bound renders nothing (see
  // SiteMembershipSection) — there's no fixed-price fallback form anymore.
  const membershipForms = mods.cotisations
    ? await prisma.membershipForm.findMany({
        where:  { association: { slug }, status: "PUBLISHED", visibility: "SITE", siteSectionId: { not: null } },
        select: { slug: true, title: true, siteSectionId: true },
      })
    : []
  // Plain object, not a Map — this crosses the server/client boundary as props to
  // SiteMembershipSection (a client component) and Map isn't serializable there.
  const membershipFormBySection: Record<string, { slug: string; title: string }> =
    Object.fromEntries(membershipForms.map(f => [f.siteSectionId as string, { slug: f.slug, title: f.title }]))
  // The header's single CTA, when more than one section has a bound form: whichever one
  // appears first in the page's own section order, not an arbitrary/unordered DB row — an
  // admin reordering sections on the page is the one lever they already have to control
  // this, and it matches what a visitor scrolling down actually meets first.
  const siteSections = (assoc.siteConfig as SiteConfig | null)?.sections ?? []
  const firstBoundMembershipForm = siteSections
    .filter((s): s is SiteSection & { type: "membership" } => s.type === "membership")
    .map(s => membershipFormBySection[s.id])
    .find(Boolean)
  const membershipCta = firstBoundMembershipForm ? { href: `/${slug}/adhesion/${firstBoundMembershipForm.slug}` } : null

  // Same explicit form→section binding as membership (DonationForm.siteSectionId). A "dons"
  // section with nothing bound is hidden once the association uses donation forms (one has
  // been published or archived); before that — legacy associations — SiteDonsSection falls
  // back to the standalone /portal/[slug]/don page (see its own comment).
  const [donationForms, liveDonationFormCount] = mods.dons
    ? await Promise.all([
        prisma.donationForm.findMany({
          where:   { association: { slug }, status: "PUBLISHED", visibility: "SITE", siteSectionId: { not: null } },
          // Only one published form per section is allowed now, but older data can still hold
          // duplicates — most recently updated wins, deterministically.
          orderBy: { updatedAt: "desc" },
          select:  { slug: true, title: true, siteSectionId: true },
        }),
        prisma.donationForm.count({
          where: { association: { slug }, status: { in: ["PUBLISHED", "ARCHIVED"] } },
        }),
      ])
    : [[], 0]
  const donationFormBySection: Record<string, { slug: string; title: string }> = {}
  for (const donationForm of donationForms) {
    const sectionId = donationForm.siteSectionId as string
    if (!donationFormBySection[sectionId]) donationFormBySection[sectionId] = { slug: donationForm.slug, title: donationForm.title }
  }

  return {
    id:          assoc.id,
    name:        assoc.name,
    slug:        assoc.slug,
    // Une section "dons"/"boutique" peut rester dans siteConfig après désactivation du
    // module — c'est ce drapeau, pas la présence de la section, qui décide de son affichage.
    donsEnabled:     mods.dons,
    boutiqueEnabled: mods.boutique,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
    membershipFormBySection,
    membershipCta,
    donationFormBySection,
    usesDonationForms: liveDonationFormCount > 0,
    city:        assoc.city,
    country:     assoc.country,
    config:      assoc.siteConfig as SiteConfig | null,
    events: events.map(e => ({
      ...e,
      date:    e.date.toISOString(),
      endDate: e.endDate?.toISOString() ?? null,
      price:   e.price?.toString() ?? null,
      ticketTypes: e.ticketTypes.map(tt => {
        const remaining = tt.capacity != null ? Math.max(0, tt.capacity - (occupiedMap.get(tt.id) ?? 0)) : null
        return { id: tt.id, label: tt.label, price: tt.price.toString(), remaining, full: remaining === 0 }
      }),
    })) satisfies PublicEvent[],
    actualites: actualites.map(a => ({
      ...a,
      publishedAt: a.publishedAt!.toISOString(),
    })) satisfies PublicActualite[],
    boutiqueProduits: boutiqueProduits satisfies PublicBoutiqueProduit[],
    siteBuilder:       assoc.siteBuilder,
    sitePuckPublished: assoc.sitePuckPublished,
    address:           assoc.address,
    phone:             assoc.phone,
    contactEmail:      assoc.contactEmail,
    website:           assoc.website,
  }
}

type SiteData = NonNullable<Awaited<ReturnType<typeof getSiteData>>>

// Translates the association's own live content (events/actualités/boutique, read live from
// the DB by getSiteData) — shared by both builders, since the old builder's sections render
// the same data. Puck block content itself is translated separately (translateSitePuckData),
// since it is stored in sitePuckPublished rather than here.
async function translateListings(data: SiteData, locale: Locale): Promise<SiteData> {
  if (locale === DEFAULT_LOCALE) return data
  const [events, actualites, boutiqueProduits] = await Promise.all([
    translateFields(data.events, ["title", "description"], locale, data.id),
    translateFields(data.actualites, ["title", "content"], locale, data.id),
    translateFields(data.boutiqueProduits, ["name"], locale, data.id),
  ])
  return { ...data, events, actualites, boutiqueProduits }
}

// The published new-builder page when it is the live version, else null (old builder). Stored
// JSON is validated first: a missing or malformed page keeps the old builder's rendering.
function livePuckPage(data: SiteData): SitePuckData | null {
  if (data.siteBuilder !== "PUCK") return null
  try {
    return readPublishedPuckData(data.sitePuckPublished)
  } catch {
    return null
  }
}

// The live data the new builder's blocks read (puck.metadata) — the same shape the editor
// builds from the API (use-site-puck-metadata.ts), but from what visitors may see: the public
// events/actualités/products and form bindings loaded by getSiteData.
function buildSitePuckMetadata(
  data: SiteData, publishedData: SitePuckData, locale: Locale, ui: SiteUiStrings,
): SitePuckMetadata {
  // The header's single "Adhérer" button: the first membership block of the page, in reading
  // order, that has a published form bound to it (same rule as the old builder's sections).
  const firstBoundMembershipForm = listPuckBlocksOfType(publishedData, "membership")
    .map(membershipBlock => puckBlockId(membershipBlock))
    .map(blockId => (blockId ? data.membershipFormBySection[blockId] : undefined))
    .find(Boolean)

  return {
    associationName:         data.name,
    slug:                    data.slug,
    city:                    data.city,
    country:                 data.country,
    address:                 data.address,
    phone:                   data.phone,
    contactEmail:            data.contactEmail,
    website:                 data.website,
    events:                  data.events,
    actualites:              data.actualites,
    boutiqueProduits:        data.boutiqueProduits,
    membershipFormBySection: data.membershipFormBySection,
    donationFormBySection:   data.donationFormBySection,
    // The Dons block shows nothing without a bound form once this is true. With the dons
    // module off no form is loaded, so forcing it hides the block — like the old builder,
    // which skips "dons" sections when the module is off.
    usesDonationForms:       data.donsEnabled ? data.usesDonationForms : true,
    membershipCta:           firstBoundMembershipForm
      ? { href: `/${data.slug}/adhesion/${firstBoundMembershipForm.slug}` }
      : null,
    canIssueTaxReceipts:     data.canIssueTaxReceipts,
    locale,
    ui,
  }
}

function absoluteImageUrl(imageUrl: string | undefined): string | undefined {
  const trimmedUrl = imageUrl?.trim()
  return trimmedUrl && /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : undefined
}

// Search engines and link previews from the page's "Référencement et partage" settings.
function sitePuckPageMetadata(data: SiteData, publishedData: SitePuckData): Metadata {
  const rootProps   = publishedRootProps(publishedData)
  const seo         = rootProps.seo ?? {}
  const customTitle = typeof seo.title === "string" ? seo.title.trim() : ""
  const pageTitle   = customTitle || data.name
  const description = (typeof seo.description === "string" ? seo.description.trim() : "")
    || `Site officiel de ${data.name}`
  const shareImage  = absoluteImageUrl(seo.shareImage) ?? absoluteImageUrl(rootProps.logoUrl)
  const faviconUrl  = (typeof seo.favicon === "string" ? seo.favicon.trim() : "")
    || (typeof rootProps.logoUrl === "string" ? rootProps.logoUrl.trim() : "")
  const siteUrl     = `${APP_URL}/${data.slug}`

  return {
    // A title typed by the association is used as is; the name keeps the app's title template.
    title:       customTitle ? { absolute: customTitle } : data.name,
    description,
    alternates:  { canonical: siteUrl },
    openGraph:   {
      title:    pageTitle,
      description,
      url:      siteUrl,
      siteName: data.name,
      type:     "website",
      locale:   "fr_FR",
      images:   shareImage ? [{ url: shareImage }] : undefined,
    },
    twitter:     {
      card:   shareImage ? "summary_large_image" : "summary",
      title:  pageTitle,
      description,
      images: shareImage ? [shareImage] : undefined,
    },
    // Without a favicon or a logo, the app's default icons (root layout) stay.
    ...(faviconUrl ? { icons: { icon: faviconUrl, apple: faviconUrl } } : {}),
  }
}

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
      return sitePuckPageMetadata(data, translatedPage)
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

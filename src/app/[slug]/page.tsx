import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { SiteConfig, SiteSection } from "@/types/site-config"
import { SiteHeroSection }        from "@/components/site/sections/site-hero-section"
import { SiteAboutSection }       from "@/components/site/sections/site-about-section"
import { SiteEventsSection }      from "@/components/site/sections/site-events-section"
import { SiteActualitesSection }  from "@/components/site/sections/site-actualites-section"
import { SiteMembershipSection }  from "@/components/site/sections/site-membership-section"
import { SiteDonsSection }        from "@/components/site/sections/site-dons-section"
import { SiteContactSection }     from "@/components/site/sections/site-contact-section"
import { SiteNavbar }             from "@/components/site/site-navbar"
import { SiteFooter }             from "@/components/site/site-footer"
import { prisma }                 from "@/lib/prisma/client"
import { parseModules }           from "@/lib/modules"

type PublicEvent = {
  id: string; title: string; date: string; endDate: string | null
  location: string | null; description: string | null; price: string | null; capacity: number | null
  ticketTypes: { id: string; label: string; price: string; remaining: number | null; full: boolean }[]
}

type PublicActualite = {
  id: string; title: string; content: string; imageUrl: string | null
  pinned: boolean; publishedAt: string
}

async function getSiteData(slug: string) {
  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      name: true, slug: true, city: true, country: true,
      sitePublished: true, siteConfig: true, modules: true, canIssueTaxReceipts: true,
      membreTypes: { select: { id: true, name: true, color: true } },
    },
  })

  if (!assoc || !assoc.sitePublished) return null
  const mods = parseModules(assoc.modules)
  if (!mods.site) return null

  const now = new Date()
  const [events, actualites] = await Promise.all([
    mods.evenements
      ? prisma.evenement.findMany({
          where:   { association: { slug }, date: { gte: now } },
          orderBy: { date: "asc" },
          take:    20,
          select:  { id: true, title: true, date: true, endDate: true, location: true, description: true, imageUrl: true, price: true, capacity: true, ticketTypes: { orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true } } },
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

  return {
    name:        assoc.name,
    slug:        assoc.slug,
    // Une section "dons" peut rester dans siteConfig après désactivation du module —
    // c'est ce drapeau, pas la présence de la section, qui décide de son affichage.
    donsEnabled: mods.dons,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
    city:        assoc.city,
    country:     assoc.country,
    config:      assoc.siteConfig as SiteConfig | null,
    membreTypes: assoc.membreTypes,
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
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const data = await getSiteData(slug)
  if (!data) return { title: "Association introuvable" }
  return { title: data.name, description: `Site officiel de ${data.name}` }
}

export default async function PublicSitePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const data = await getSiteData(slug)
  if (!data) notFound()

  const config   = data.config
  const sections = config?.sections ?? []
  const color    = config?.primaryColor ?? "#6366f1"

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900" style={{ colorScheme: "light" }}>
      <SiteNavbar
        name={data.name}
        logoUrl={config?.logoUrl}
        color={color}
        portalSlug={slug}
        headerBgColor={config?.headerBgColor}
        headerShowMembres={config?.headerShowMembres}
        headerShowRegister={config?.headerShowRegister}
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
              return <SiteActualitesSection key={section.id} section={section} actualites={data.actualites} color={color} />
            case "membership":
              return (
                <SiteMembershipSection key={section.id} section={section} slug={slug} membreTypes={data.membreTypes} color={color} />
              )
            case "dons":
              return data.donsEnabled
                ? <SiteDonsSection key={section.id} section={section} slug={slug} color={color} canIssueTaxReceipts={data.canIssueTaxReceipts} />
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

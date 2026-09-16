"use client"

import { useTranslations } from "next-intl"
import type { SiteConfig, SiteSection } from "@/types/site-config"
import { getSiteColorVars } from "@/lib/site-theme"
import { SITE_FONTS, SITE_DEFAULT_FONT, isSiteFontKey } from "@/lib/site-fonts"
import { cn } from "@/lib/utils"
import { SiteNavbar }            from "@/components/site/site-navbar"
import { SiteFooter }            from "@/components/site/site-footer"
import { SiteHeroSection }       from "@/components/site/sections/site-hero-section"
import { SiteAboutSection }      from "@/components/site/sections/site-about-section"
import { SiteEventsSection }     from "@/components/site/sections/site-events-section"
import { SiteActualitesSection } from "@/components/site/sections/site-actualites-section"
import { SiteMembershipSection } from "@/components/site/sections/site-membership-section"
import { SiteDonsSection }       from "@/components/site/sections/site-dons-section"
import { SiteBoutiqueSection }   from "@/components/site/sections/site-boutique-section"
import { SiteContactSection }    from "@/components/site/sections/site-contact-section"

type PublicEvent = {
  id: string; slug: string | null; title: string; date: string; endDate: string | null
  location: string | null; description: string | null; imageUrl: string | null
  price: string | null; capacity: number | null
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

type FormBinding = { slug: string; title: string }

type Props = {
  config:      SiteConfig | null
  name:        string
  slug:        string
  city:        string | null
  country:     string
  events:      PublicEvent[]
  actualites?: PublicActualite[]
  boutiqueProduits?: PublicBoutiqueProduit[]
  membershipFormBySection?: Record<string, FormBinding>
  // Draft-aware: reflects a form picked in the section sheet before the site is saved.
  donationFormBySection?:   Record<string, FormBinding>
  usesDonationForms?:       boolean
  membershipCta?: { href: string } | null
  canIssueTaxReceipts?: boolean
  donsEnabled: boolean
  boutiqueEnabled: boolean
}

// A placeholder shown only in the editor, never saved and never sent to the public site — lets
// SiteMembershipSection render its real CTA markup (title, body, button styling) even before an
// admin has published/linked a MembershipForm, with a "preview only" badge layered on top.
const PREVIEW_MEMBERSHIP_FORM: FormBinding = { slug: "#", title: "Voir la page d'adhésion" }
// Same idea for a "dons" section with no form: SiteDonsSection would render nothing, so the
// preview hands it a stand-in to keep the block visible under its "no form" overlay.
const PREVIEW_DONATION_FORM: FormBinding = { slug: "#", title: "" }

export function SitePreviewPanel({
  config, name, slug, city, country, events,
  actualites = [], boutiqueProduits = [],
  membershipFormBySection = {}, donationFormBySection = {}, usesDonationForms = false, membershipCta = null,
  canIssueTaxReceipts = false, donsEnabled, boutiqueEnabled,
}: Props) {
  const t        = useTranslations("site.preview")
  const sections = config?.sections ?? []
  const color    = "var(--site-primary)"
  const fontKey  = isSiteFontKey(config?.fontFamily) ? config!.fontFamily! : SITE_DEFAULT_FONT
  const font     = SITE_FONTS[fontKey]

  // Every section component below is the exact one the public site renders — clicking one of
  // its <Link>s here would navigate the dashboard itself away to the public route, which
  // makes no sense inside a preview pane. Swallow all link clicks at the wrapper instead of
  // stripping interactivity from the components themselves.
  function suppressNavigation(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("a")) e.preventDefault()
  }

  return (
    <div
      className={cn("min-h-full bg-white text-gray-900", font.variable)}
      style={{ colorScheme: "light", fontFamily: font.cssVar, ...getSiteColorVars(config) }}
      onClickCapture={suppressNavigation}
    >
      <SiteNavbar
        name={name || "Mon association"}
        logoUrl={config?.logoUrl}
        color={color}
        secondaryColor="var(--site-secondary)"
        portalSlug={slug}
        headerBgColor={config?.headerBgColor}
        headerShowMembres={config?.headerShowMembres}
        headerShowRegister={config?.headerShowRegister}
        membershipCta={membershipCta}
      />

      <main>
        {sections.length === 0 && (
          <div className="py-24 text-center text-sm text-gray-400">
            Aucune section — ajoutez-en une depuis le panneau de gauche.
          </div>
        )}

        {sections.map((section: SiteSection) => {
          switch (section.type) {
            case "hero":
              return <SiteHeroSection key={section.id} section={section} color={color} />
            case "about":
              return <SiteAboutSection key={section.id} section={section} />
            case "events":
              return <SiteEventsSection key={section.id} section={section} events={events} color={color} slug={slug} />
            case "actualites":
              return <SiteActualitesSection key={section.id} section={section} actualites={actualites} color={color} slug={slug} />

            case "membership": {
              const bound = membershipFormBySection[section.id]
              return (
                <div key={section.id} className="relative">
                  {!bound && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-900 text-white text-center mx-4">
                        Aperçu — nécessite un formulaire d&apos;adhésion publié et lié à cette section
                      </span>
                    </div>
                  )}
                  <SiteMembershipSection
                    section={section} slug={slug} color={color}
                    membershipForm={bound ?? PREVIEW_MEMBERSHIP_FORM}
                  />
                </div>
              )
            }

            case "dons": {
              const boundDonationForm = donationFormBySection[section.id]
              // Legacy associations (no form ever live) keep the generic donation link, so
              // there's nothing to flag; the module-disabled overlay already covers the rest.
              const hiddenForLackOfForm = donsEnabled && usesDonationForms && !boundDonationForm
              return (
                <div key={section.id} className="relative">
                  {!donsEnabled && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-600 text-white">
                        Module Dons désactivé — invisible sur le site public
                      </span>
                    </div>
                  )}
                  {hiddenForLackOfForm && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-900 text-white text-center mx-4">
                        {t("donsNoForm")}
                      </span>
                    </div>
                  )}
                  <SiteDonsSection
                    section={section} slug={slug} color={color}
                    canIssueTaxReceipts={canIssueTaxReceipts}
                    donationForm={boundDonationForm ?? (usesDonationForms ? PREVIEW_DONATION_FORM : null)}
                    usesDonationForms={usesDonationForms}
                  />
                </div>
              )
            }

            case "boutique":
              return (
                <div key={section.id} className="relative">
                  {!boutiqueEnabled && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-600 text-white">
                        Module Boutique désactivé — invisible sur le site public
                      </span>
                    </div>
                  )}
                  <SiteBoutiqueSection section={section} produits={boutiqueProduits} color={color} slug={slug} />
                </div>
              )

            case "contact":
              return <SiteContactSection key={section.id} section={section} city={city} country={country} />
          }
        })}
      </main>

      <SiteFooter
        name={name || "Mon association"}
        footerText={config?.footerText}
        footerBgColor={config?.footerBgColor}
        footerLinks={config?.footerLinks}
        color={color}
      />
    </div>
  )
}

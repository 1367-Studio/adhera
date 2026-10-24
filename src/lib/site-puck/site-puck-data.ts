import type { Data } from "@puckeditor/core"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"
import type { HeaderLinkItem, HeaderPillVariant, MenuContentBackground } from "@/components/site/site-header-link-style"
import type { SectionBlockProps } from "@/components/site/blocks/site-block-section-container"
import type { ColumnsBlockProps } from "@/components/site/blocks/site-block-columns"
import type { SpacerBlockProps } from "@/components/site/blocks/site-block-spacer"
import type { HeadingBlockProps } from "@/components/site/blocks/site-block-heading"
import type { TextBlockProps } from "@/components/site/blocks/site-block-text"
import type { ImageBlockProps } from "@/components/site/blocks/site-block-image"
import type { ButtonsBlockProps } from "@/components/site/blocks/site-block-buttons"
import type { VideoBlockProps } from "@/components/site/blocks/site-block-video"
import type { MediaTextBlockProps } from "@/components/site/blocks/site-block-media-text"
import type { BannerBlockProps } from "@/components/site/blocks/site-block-banner"
import type { CtaBannerBlockProps } from "@/components/site/blocks/site-block-cta-banner"
import type { StatsBlockProps } from "@/components/site/blocks/site-block-stats"
import type { FeaturesBlockProps } from "@/components/site/blocks/site-block-features"
import type { TestimonialsBlockProps } from "@/components/site/blocks/site-block-testimonials"
import type { TeamBlockProps } from "@/components/site/blocks/site-block-team"
import type { FaqBlockProps } from "@/components/site/blocks/site-block-faq"
import type { ContactBlockProps } from "@/components/site/blocks/site-block-contact"
import type { MapBlockProps } from "@/components/site/blocks/site-block-map"
import type { PartnersBlockProps } from "@/components/site/blocks/site-block-partners"
import type { GalleryBlockProps } from "@/components/site/blocks/site-block-gallery"
import type { SocialLinksBlockProps } from "@/components/site/blocks/site-block-social-links"
import type { TranslateBlockProps } from "@/components/site/blocks/site-block-translate"
import type { SiteCornerStyle } from "@/components/site/blocks/site-block-theme"
import type { SocialLink } from "@/components/site/site-social-icons"
import type { SiteFooterSettings } from "@/components/site/site-builder-footer"
import type { SiteAnimationLevel } from "@/components/site/site-animations"
import type { SiteCookieSettings } from "@/components/site/site-cookie-consent"
import type { FormCtaStyleProps } from "@/components/site/blocks/site-block-form-cta"
import type { EventsBlockProps } from "@/components/site/blocks/site-block-events"
import type { ActualitesBlockProps } from "@/components/site/blocks/site-block-actualites"
import type { BoutiqueBlockProps } from "@/components/site/blocks/site-block-boutique"
import {
  DEFAULT_SITE_CONFIG,
  type AboutSection, type ContactSection,
  type DonsSection, type HeroSection, type MembershipSection,
  type SectionType, type SiteConfig, type SiteSection,
} from "@/types/site-config"

// FORM-7 Puck trial: converts between the stored SiteConfig and Puck's Data, both ways, so
// the editor can be tried on real sites without any schema change. Each section keeps its id
// as the Puck item id — MembershipForm/DonationForm.siteSectionId point at it.

type SectionFields<Section extends SiteSection> = Omit<Section, "id" | "type">

// One Puck component per section type, keyed by the type itself so the mapping stays 1:1.
export type SitePuckComponents = {
  hero:       SectionFields<HeroSection>
  about:      SectionFields<AboutSection>
  events:     EventsBlockProps
  actualites: ActualitesBlockProps
  // Adhésion and Dons also take the layouts and section styles of the new builder.
  membership: SectionFields<MembershipSection> & FormCtaStyleProps
  // donationFormPick is builder-only state of the old editor, never stored — left out here.
  dons:       Omit<SectionFields<DonsSection>, "donationFormPick"> & FormCtaStyleProps
  boutique:   BoutiqueBlockProps
  contact:    SectionFields<ContactSection>
  // New builder blocks (FORM-7). Not part of SiteConfig yet: puckDataToSiteConfig drops them
  // until the stored format moves to Puck data.
  section:      SectionBlockProps
  columns:      ColumnsBlockProps
  spacer:       SpacerBlockProps
  heading:      HeadingBlockProps
  text:         TextBlockProps
  image:        ImageBlockProps
  buttons:      ButtonsBlockProps
  video:        VideoBlockProps
  mediaText:    MediaTextBlockProps
  banner:       BannerBlockProps
  ctaBanner:    CtaBannerBlockProps
  stats:        StatsBlockProps
  features:     FeaturesBlockProps
  testimonials: TestimonialsBlockProps
  team:         TeamBlockProps
  faq:          FaqBlockProps
  contactInfo:  ContactBlockProps
  map:          MapBlockProps
  partners:     PartnersBlockProps
  gallery:      GalleryBlockProps
  socialLinks:  SocialLinksBlockProps
  translate:    TranslateBlockProps
}

// Everything in SiteConfig that is not a section (theme, header, footer), plus the new
// builder's style settings, which SiteConfig does not store yet.
// footerText is optional here: the new footer settings replace it in the panel, and the old
// value only seeds them (see the root resolveData in site-puck-config.tsx).
export type SitePuckRootProps = Omit<SiteConfig, "sections" | "footerText"> & {
  footerText?:  string
  stylePreset?: string
  cornerStyle?: SiteCornerStyle
  // "auto" (default): hidden once a logo is uploaded.
  headerShowName?: "auto" | "show" | "hide"
  // Entered once, shown in the header and/or the footer.
  socialLinks?:    SocialLink[]
  socialInHeader?: boolean
  // The language switcher (PublicSiteLocaleSwitcher), next to "Adhérer" / "Se connecter" —
  // previously only reachable as a page-content block ("Traduction"), which an association
  // could place anywhere, including nowhere near the header it looks like it belongs in.
  headerShowTranslate?: boolean
  // Plain external/internal link buttons in the header (e.g. a partner site, a booking page) —
  // same {label, href} shape and new-tab-for-external behaviour as the Boutons content block
  // and the footer links, via resolveSiteHref/isExternalHref. Each has its own border/no-border
  // style (variant); undefined = "outline", same as the pre-existing "Adhérer" button.
  headerLinks?: HeaderLinkItem[]
  // A labelled dropdown for associations with several membership forms (e.g. one per country
  // or chapter) that would otherwise need one "Adhérer" button each. Each item is a plain
  // SiteLink: an internal form path or an external URL both work.
  headerAdhesionMenuLabel?:             string
  headerAdhesionMenuVariant?:           HeaderPillVariant
  headerAdhesionMenuContentBackground?: MenuContentBackground
  headerAdhesionMenuItems?:             SiteLink[]
  // "Se connecter" was always filled before this existed — undefined = "primary", its original
  // look, so no existing site changes just because the field now exists.
  headerSeConnecterVariant?: HeaderPillVariant
  // New footer (logo position, columns, socials, bottom line). Missing on sites from the old
  // builder: the editor fills it from footerText / footerBgColor / footerLinks on load.
  footer?:         SiteFooterSettings
  // Scroll reveal of the blocks; undefined = "subtle".
  animations?:     SiteAnimationLevel
  // Cookie banner for third-party embeds (videos); undefined = shown with the default text.
  cookies?:        SiteCookieSettings
  // Search engines and link previews. Stored with the draft; applied to the public page's
  // metadata when publishing moves to this format.
  seo?:            SiteSeoSettings
}

export type SiteSeoSettings = {
  // Browser tab and search result title. Empty: the association's name.
  title?:       string
  // Search result snippet, ~160 characters. Empty: a generic sentence with the name.
  description?: string
  // Link preview image (Facebook, WhatsApp, LinkedIn…), ideally 1200×630. Empty: the logo.
  shareImage?:  string
  // Browser tab icon, square. Empty: the logo, then the Formwise icon.
  favicon?:     string
}

export type SitePuckData = Data<SitePuckComponents, SitePuckRootProps>

const SECTION_TYPES: readonly SectionType[] = [
  "hero", "about", "events", "actualites", "membership", "dons", "boutique", "contact",
]

export function siteConfigToPuckData(siteConfig: SiteConfig | null): SitePuckData {
  const { sections, ...rootProps } = { ...DEFAULT_SITE_CONFIG, ...siteConfig }
  return {
    root:    { props: rootProps },
    content: sections.map(section => {
      const { id, type, ...sectionFields } = section
      if (type === "dons") delete (sectionFields as Partial<DonsSection>).donationFormPick
      return { type, props: { id, ...sectionFields } } as SitePuckData["content"][number]
    }),
  }
}

export function puckDataToSiteConfig(puckData: SitePuckData): SiteConfig {
  const sections = puckData.content
    .filter(item => (SECTION_TYPES as readonly string[]).includes(item.type))
    .map(item => {
      const { id, ...sectionFields } = item.props
      return { id, type: item.type, ...sectionFields } as SiteSection
    })
  return { ...DEFAULT_SITE_CONFIG, ...puckData.root.props, sections }
}

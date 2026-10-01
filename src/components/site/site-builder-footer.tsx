import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import type { ObjectField } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { isColorDark } from "@/lib/color"
import { colorField, imageField, YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { resolveSiteHref } from "@/components/site/blocks/site-block-button"
import { SiteSocialIcons, visibleSocialLinks, type SocialLink } from "@/components/site/site-social-icons"

// Footer of the new site builder (site-wide, edited from the Puck root fields). Existing sites
// that never saved a `footer` object keep their old settings through resolveFooterSettings.

export type SiteFooterLayout     = "columns" | "centered" | "simple"
export type SiteFooterAlignment  = "left" | "center" | "right"
export type SiteFooterBackground = "dark" | "light" | "primary" | "secondary" | "custom"
export type SiteFooterLink       = { label: string; href: string }
export type SiteFooterColumn     = { title: string; links: SiteFooterLink[] }

export type SiteFooterSettings = {
  layout?:           SiteFooterLayout
  showLogo?:         boolean
  logoPosition?:     SiteFooterAlignment
  /** Overrides the site logo; empty = site logo. */
  logoUrl?:          string
  description?:      string
  columns?:          SiteFooterColumn[]
  showSocial?:       boolean
  /** Empty = "© {year} {association name}. Tous droits réservés." */
  bottomText?:       string
  bottomAlign?:      SiteFooterAlignment
  background?:       SiteFooterBackground
  customBackground?: string
}

export type ResolvedSiteFooterSettings = Required<Omit<SiteFooterSettings, "logoUrl" | "customBackground">> & {
  logoUrl:          string
  customBackground: string
}

export type SiteFooterLegacySettings = {
  footerText?:    string
  footerBgColor?: string
  footerLinks?:   { label: string; url: string }[]
}

const MAX_FOOTER_COLUMNS          = 4
const MAX_FOOTER_LINKS_PER_COLUMN = 8

// The single fixed dark surface of the public site (zinc-900): the site is light-only, so this
// is not a theme colour but the one "dark footer" option offered to volunteers.
const DARK_FOOTER_SURFACE = "#18181b"

const ALIGNMENT_OPTIONS = [
  { label: "Gauche", value: "left" },
  { label: "Centre", value: "center" },
  { label: "Droite", value: "right" },
]

export const DEFAULT_SITE_FOOTER_SETTINGS: ResolvedSiteFooterSettings = {
  layout:       "columns",
  showLogo:     true,
  logoPosition: "left",
  logoUrl:      "",
  description:  "",
  columns: [
    {
      title: "L'association",
      links: [
        { label: "Qui sommes-nous", href: "/" },
        { label: "Événements",      href: "/evenements" },
        { label: "Actualités",      href: "/actualites" },
      ],
    },
    {
      title: "Nous rejoindre",
      links: [
        { label: "Adhérer",       href: "/" },
        { label: "Faire un don",  href: "/" },
        { label: "Contact",       href: "/" },
      ],
    },
  ],
  showSocial:       true,
  bottomText:       "",
  bottomAlign:      "center",
  background:       "dark",
  customBackground: "",
}

export const SITE_FOOTER_FIELD: ObjectField<SiteFooterSettings> = {
  type:  "object",
  label: "Pied de page",
  objectFields: {
    layout: {
      type:    "radio",
      label:   "Disposition",
      options: [
        { label: "Colonnes", value: "columns" },
        { label: "Centré",   value: "centered" },
        { label: "Simple",   value: "simple" },
      ],
    },
    showLogo:     { type: "radio", label: "Afficher le logo", options: YES_NO_OPTIONS },
    logoPosition: { type: "radio", label: "Position du logo", options: ALIGNMENT_OPTIONS },
    logoUrl:      imageField<string | undefined>("Logo du pied de page (facultatif, sinon logo du site)"),
    description:  { type: "textarea", label: "Description" },
    columns: {
      type:  "array",
      label: "Colonnes de liens",
      max:   MAX_FOOTER_COLUMNS,
      arrayFields: {
        title: { type: "text", label: "Titre de la colonne" },
        links: {
          type:  "array",
          label: "Liens",
          max:   MAX_FOOTER_LINKS_PER_COLUMN,
          arrayFields: {
            label: { type: "text", label: "Texte" },
            href:  { type: "text", label: "Lien (https://… ou /page)" },
          },
          defaultItemProps: { label: "Nouveau lien", href: "/" },
          getItemSummary:   footerLink => footerLink.label || "Lien",
        },
      },
      defaultItemProps: { title: "Nouvelle colonne", links: [] },
      getItemSummary:   footerColumn => footerColumn.title || "Colonne",
    },
    showSocial:  { type: "radio", label: "Afficher les réseaux sociaux", options: YES_NO_OPTIONS },
    bottomText:  { type: "text", label: "Mention du bas (vide = © année + nom)" },
    bottomAlign: { type: "radio", label: "Alignement de la mention", options: ALIGNMENT_OPTIONS },
    background: {
      type:    "select",
      label:   "Fond",
      options: [
        { label: "Sombre",          value: "dark" },
        { label: "Clair",           value: "light" },
        { label: "Couleur principale", value: "primary" },
        { label: "Couleur secondaire", value: "secondary" },
        { label: "Personnalisé",    value: "custom" },
      ],
    },
    customBackground: colorField<string | undefined>("Couleur de fond personnalisée"),
  },
}

export function resolveFooterSettings(
  footer: SiteFooterSettings | undefined,
  legacy: SiteFooterLegacySettings,
): ResolvedSiteFooterSettings {
  if (!footer) {
    const legacyLinks = (legacy.footerLinks ?? []).map(legacyLink => ({ label: legacyLink.label, href: legacyLink.url }))
    return {
      ...DEFAULT_SITE_FOOTER_SETTINGS,
      description:      legacy.footerText ?? "",
      columns:          legacyLinks.length > 0 ? [{ title: "Liens", links: legacyLinks }] : [],
      background:       legacy.footerBgColor ? "custom" : "light",
      customBackground: legacy.footerBgColor ?? "",
    }
  }
  return {
    layout:           footer.layout ?? DEFAULT_SITE_FOOTER_SETTINGS.layout,
    showLogo:         footer.showLogo ?? DEFAULT_SITE_FOOTER_SETTINGS.showLogo,
    logoPosition:     footer.logoPosition ?? DEFAULT_SITE_FOOTER_SETTINGS.logoPosition,
    logoUrl:          footer.logoUrl ?? "",
    description:      footer.description ?? "",
    columns:          (footer.columns ?? []).slice(0, MAX_FOOTER_COLUMNS).map(footerColumn => ({
      title: footerColumn.title ?? "",
      links: (footerColumn.links ?? []).slice(0, MAX_FOOTER_LINKS_PER_COLUMN),
    })),
    showSocial:       footer.showSocial ?? DEFAULT_SITE_FOOTER_SETTINGS.showSocial,
    bottomText:       footer.bottomText ?? "",
    bottomAlign:      footer.bottomAlign ?? DEFAULT_SITE_FOOTER_SETTINGS.bottomAlign,
    background:       footer.background ?? DEFAULT_SITE_FOOTER_SETTINGS.background,
    customBackground: footer.customBackground ?? "",
  }
}

function footerSurfaceStyle(background: SiteFooterBackground, customBackground: string): CSSProperties {
  switch (background) {
    case "dark":
      return { background: DARK_FOOTER_SURFACE, color: "#ffffff" }
    case "primary":
      return { background: "var(--site-primary)", color: "var(--site-primary-foreground)" }
    case "secondary":
      return { background: "var(--site-secondary)", color: "var(--site-secondary-foreground)" }
    case "custom": {
      if (!customBackground) break
      return { background: customBackground, color: isColorDark(customBackground) ? "#ffffff" : "var(--site-text)" }
    }
  }
  return { background: "var(--site-surface-muted)", color: "var(--site-text)" }
}

const MUTED_TEXT_STYLE: CSSProperties = { color: "color-mix(in srgb, currentColor 70%, transparent)" }
const DIVIDER_STYLE: CSSProperties    = { borderColor: "color-mix(in srgb, currentColor 15%, transparent)" }

const TEXT_ALIGNMENT_CLASS: Record<SiteFooterAlignment, string> = {
  left:   "text-left",
  center: "text-center",
  right:  "text-right",
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//.test(href)
}

function FooterLink({ link, slug, className }: { link: SiteFooterLink; slug: string; className?: string }) {
  const linkClass = cn("text-sm transition-opacity hover:opacity-100 hover:underline underline-offset-4", className)
  const href      = resolveSiteHref(link.href ?? "", slug)
  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass} style={MUTED_TEXT_STYLE}>
        {link.label}
      </a>
    )
  }
  return <Link href={href} className={linkClass} style={MUTED_TEXT_STYLE}>{link.label}</Link>
}

function visibleLinks(links: SiteFooterLink[] | undefined): SiteFooterLink[] {
  return (links ?? []).filter(footerLink => typeof footerLink.label === "string" && footerLink.label.trim() !== "")
}

type SiteBuilderFooterProps = {
  settings:        SiteFooterSettings | undefined
  legacy:          SiteFooterLegacySettings
  associationName: string
  siteLogoUrl?:    string
  socialLinks?:    SocialLink[]
  slug:            string
}

export function SiteBuilderFooter({ settings, legacy, associationName, siteLogoUrl, socialLinks, slug }: SiteBuilderFooterProps) {
  const footerSettings = resolveFooterSettings(settings, legacy)
  const logoSource     = footerSettings.logoUrl || siteLogoUrl || ""
  const hasSocialLinks = footerSettings.showSocial && visibleSocialLinks(socialLinks).length > 0
  const visibleColumns = footerSettings.columns
    .map(footerColumn => ({ ...footerColumn, links: visibleLinks(footerColumn.links) }))
    .filter(footerColumn => footerColumn.links.length > 0 || footerColumn.title.trim() !== "")
  const flattenedLinks = visibleColumns.flatMap(footerColumn => footerColumn.links)
  const bottomText     = footerSettings.bottomText.trim()
    || `© ${new Date().getFullYear()} ${associationName}. Tous droits réservés.`
  const logoPosition   = footerSettings.logoPosition

  const homeHref = resolveSiteHref("/", slug)
  const brandMark: ReactNode = footerSettings.showLogo ? (
    <Link href={homeHref} className="inline-flex" aria-label={logoSource ? associationName : undefined}>
      {logoSource ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSource} alt={associationName} height={40} className="h-10 w-auto max-w-48 object-contain" />
      ) : (
        <span className="text-xl font-semibold">{associationName}</span>
      )}
    </Link>
  ) : null

  const description = footerSettings.description.trim() ? (
    <p className="max-w-sm text-sm leading-relaxed whitespace-pre-line" style={MUTED_TEXT_STYLE}>
      {footerSettings.description}
    </p>
  ) : null

  const socialIcons = hasSocialLinks ? <SiteSocialIcons socialLinks={socialLinks} variant="round" /> : null

  const flattenedLinksNav = flattenedLinks.length > 0 ? (
    <nav aria-label="Pied de page">
      <ul className={cn("flex flex-wrap gap-x-6 gap-y-2", footerSettings.layout === "centered" && "justify-center")}>
        {flattenedLinks.map((footerLink, linkIndex) => (
          <li key={`${footerLink.label}-${linkIndex}`}><FooterLink link={footerLink} slug={slug} /></li>
        ))}
      </ul>
    </nav>
  ) : null

  let mainContent: ReactNode

  if (footerSettings.layout === "centered") {
    mainContent = (
      <div className="flex flex-col items-center gap-6 text-center">
        {brandMark}
        {description}
        {socialIcons}
        {flattenedLinksNav}
      </div>
    )
  } else if (footerSettings.layout === "simple") {
    const brandFirst = logoPosition !== "right"
    mainContent = (
      <div
        className={cn(
          "flex flex-col gap-6 md:flex-row md:items-center",
          logoPosition === "center" ? "md:justify-center md:gap-10" : "md:justify-between",
          !brandFirst && "md:flex-row-reverse",
        )}
      >
        {brandMark}
        {flattenedLinksNav}
        {socialIcons}
      </div>
    )
  } else {
    const isCentered = logoPosition === "center"
    const brandBlock = (brandMark || description || socialIcons) ? (
      <div className={cn("flex flex-col gap-5", isCentered ? "items-center text-center" : "items-start", "lg:max-w-sm")}>
        {brandMark}
        {description}
        {socialIcons}
      </div>
    ) : null
    const columnsGrid = visibleColumns.length > 0 ? (
      <nav
        aria-label="Pied de page"
        className={cn(
          "grid grid-cols-2 gap-x-8 gap-y-10",
          visibleColumns.length >= 3 && "sm:grid-cols-3",
          visibleColumns.length >= 4 && "lg:grid-cols-4",
          isCentered && "mx-auto text-center",
        )}
      >
        {visibleColumns.map((footerColumn, columnIndex) => (
          <div key={`${footerColumn.title}-${columnIndex}`} className="flex flex-col gap-4">
            {footerColumn.title.trim() && (
              <h2 className="text-xs font-semibold tracking-wider uppercase">{footerColumn.title}</h2>
            )}
            <ul className="flex flex-col gap-3">
              {footerColumn.links.map((footerLink, linkIndex) => (
                <li key={`${footerLink.label}-${linkIndex}`}><FooterLink link={footerLink} slug={slug} /></li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    ) : null
    mainContent = (
      <div
        className={cn(
          "flex flex-col gap-12",
          isCentered
            ? "items-center"
            : cn("lg:flex-row lg:items-start lg:justify-between lg:gap-16", logoPosition === "right" && "lg:flex-row-reverse"),
        )}
      >
        {brandBlock}
        {columnsGrid}
      </div>
    )
  }

  return (
    <footer style={footerSurfaceStyle(footerSettings.background, footerSettings.customBackground)}>
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-8 sm:px-6 md:pt-20">
        {mainContent}
        <div className="mt-12 border-t pt-8 md:mt-16" style={DIVIDER_STYLE}>
          <p className={cn("text-sm", TEXT_ALIGNMENT_CLASS[footerSettings.bottomAlign])} style={MUTED_TEXT_STYLE}>
            {bottomText}
          </p>
        </div>
      </div>
    </footer>
  )
}

import type { CSSProperties } from "react"
import type { Fields } from "@puckeditor/core"
import { SiteButton } from "@/components/site/blocks/site-block-button"
import {
  SECTION_STYLE_FIELDS, isColoredBackground, mutedTextStyle, type SectionBackground, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

// Shared pieces of the "Contenu Formwise" listing blocks (Événements, Actualités, Boutique):
// header with the optional "see all" link, card and accent styles that stay readable on every
// section background, and the item limit.

// SECTION_STYLE_FIELDS for blocks that existed before the style options: their stored data has
// no background/spacing/width, so the props are optional and defaulted in render. Same fields,
// typed for optional values (Puck's Field<T> is invariant in T).
export const OPTIONAL_SECTION_STYLE_FIELDS = SECTION_STYLE_FIELDS as unknown as Fields<Partial<SectionStyleProps>>

export function resolveListingLimit(limit: number | undefined, fallbackLimit: number): number {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallbackLimit
}

// A plain-text teaser, not RichTextView: the whole card is a <Link>, and rich content can
// contain its own <a>, which would nest an anchor inside an anchor.
export function plainTextExcerpt(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

export function formatLongDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

export function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

// Border of cards and separators: the grey token on light sections, the text colour on
// coloured ones.
export function listingBorderColor(background: SectionBackground): string {
  return isColoredBackground(background) ? "color-mix(in srgb, currentColor 25%, transparent)" : "var(--site-border)"
}

export function listingCardStyle(background: SectionBackground): CSSProperties {
  return {
    border:       `1px solid ${listingBorderColor(background)}`,
    borderRadius: "var(--site-radius)",
    background:   isColoredBackground(background) ? "transparent" : "var(--site-surface)",
  }
}

// Dates, prices: the primary colour on light sections, the section text colour on coloured ones
// (primary on primary would vanish).
export function listingAccentStyle(background: SectionBackground): CSSProperties {
  return isColoredBackground(background) ? {} : { color: "var(--site-primary)" }
}

// "À la une" and similar semantic badges.
export function listingBadgeStyle(background: SectionBackground): CSSProperties {
  return isColoredBackground(background)
    ? { border: "1px solid currentColor", borderRadius: "var(--site-radius)" }
    : { background: "var(--site-primary)", color: "var(--site-primary-foreground)", borderRadius: "var(--site-radius)" }
}

export const LISTING_IMAGE_RADIUS: CSSProperties = { borderRadius: "var(--site-radius)" }

type SiteListingHeaderProps = {
  title:         string
  intro:         string | undefined
  background:    SectionBackground
  showAllLabel?: string
  /** Full app path of the listing page, e.g. `/${slug}/evenements`. */
  showAllHref?:  string
  slug:          string
}

export function SiteListingHeader({ title, intro, background, showAllLabel, showAllHref, slug }: SiteListingHeaderProps) {
  const hasShowAll = Boolean(showAllLabel && showAllHref)
  if (!title && !intro && !hasShowAll) return null
  return (
    <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex max-w-2xl flex-col gap-3">
        {title && <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>}
        {intro && <p className="text-base leading-relaxed text-pretty whitespace-pre-line sm:text-lg" style={mutedTextStyle(background)}>{intro}</p>}
      </div>
      {hasShowAll && (
        <SiteButton
          link={{ label: showAllLabel ?? "", href: showAllHref ?? "" }}
          slug={slug}
          variant="outline"
          isResolvedHref
          className="shrink-0 self-start sm:self-auto"
        />
      )}
    </div>
  )
}

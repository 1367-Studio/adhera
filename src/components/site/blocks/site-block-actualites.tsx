import Link from "next/link"
import type { ComponentConfig } from "@puckeditor/core"
import { cn } from "@/lib/utils"
import { YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { readSiteMetadata, type SitePuckMetadata } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import {
  SECTION_STYLE_DEFAULTS, SiteBlockSection, mutedTextStyle,
  type SectionBackground, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import {
  LISTING_IMAGE_RADIUS, OPTIONAL_SECTION_STYLE_FIELDS, SiteListingHeader, formatLongDate, listingBadgeStyle, listingBorderColor, listingCardStyle,
  plainTextExcerpt, resolveListingLimit,
} from "@/components/site/blocks/site-block-listing"

// "Actualités": the association's published news, read live from puck.metadata (already
// ordered upstream, pinned first). Existing sites only store { title, limit }: every other
// prop is optional and defaulted in render.

type SiteActualite = SitePuckMetadata["actualites"][number]

export type ActualitesLayout = "grid" | "list" | "featured"

export type ActualitesBlockProps = Partial<SectionStyleProps> & {
  title:          string
  limit:          number
  intro?:         string
  layout?:        ActualitesLayout
  showImages?:    boolean
  showExcerpt?:   boolean
  showAllButton?: boolean
}

const DEFAULT_LIMIT = 3

function ActualiteMeta(
  { actualite, background, locale, featuredBadgeLabel }:
  { actualite: SiteActualite; background: SectionBackground; locale: string; featuredBadgeLabel: string },
) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actualite.pinned && (
        <span className="px-2 py-0.5 text-xs font-semibold" style={listingBadgeStyle(background)}>{featuredBadgeLabel}</span>
      )}
      <time dateTime={actualite.publishedAt} className="text-sm" style={mutedTextStyle(background)}>
        {formatLongDate(actualite.publishedAt, locale)}
      </time>
    </div>
  )
}

function ActualiteExcerpt({ actualite, background, lineClampClass }: { actualite: SiteActualite; background: SectionBackground; lineClampClass: string }) {
  const contentExcerpt = plainTextExcerpt(actualite.content)
  if (!contentExcerpt) return null
  return <p className={cn("text-sm leading-relaxed", lineClampClass)} style={mutedTextStyle(background)}>{contentExcerpt}</p>
}

// A compact row: small thumbnail, date, title, optional excerpt. Used by "list" and by the
// secondary items of "featured".
function ActualiteRow({
  actualite, href, background, withImage, withExcerpt, isCompact, locale, featuredBadgeLabel,
}: {
  actualite:   SiteActualite
  href:        string
  background:  SectionBackground
  withImage:   boolean
  withExcerpt: boolean
  isCompact:   boolean
  locale:      string
  featuredBadgeLabel: string
}) {
  return (
    <Link href={href} className={cn("group flex gap-5", isCompact ? "py-4" : "py-5")}>
      {withImage && actualite.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={actualite.imageUrl}
          alt=""
          loading="lazy"
          className={cn("aspect-[4/3] shrink-0 object-cover", isCompact ? "w-24" : "w-28 sm:w-40")}
          style={LISTING_IMAGE_RADIUS}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ActualiteMeta actualite={actualite} background={background} locale={locale} featuredBadgeLabel={featuredBadgeLabel} />
        <h3 className={cn("leading-snug font-semibold group-hover:underline", isCompact ? "text-base" : "text-lg")}>{actualite.title}</h3>
        {withExcerpt && <ActualiteExcerpt actualite={actualite} background={background} lineClampClass="line-clamp-2" />}
      </div>
    </Link>
  )
}

export const actualitesBlock: ComponentConfig<ActualitesBlockProps> = {
  label: "Actualités",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    intro: { type: "textarea", label: "Introduction (facultatif)", contentEditable: true },
    limit: { type: "number", label: "Nombre affiché", min: 1, max: 20 },
    layout: {
      type:    "radio",
      label:   "Présentation",
      options: [
        { label: "Grille",       value: "grid" },
        { label: "Liste",        value: "list" },
        { label: "À la une",     value: "featured" },
      ],
    },
    showImages:    { type: "radio", label: "Afficher les images", options: YES_NO_OPTIONS },
    showExcerpt:   { type: "radio", label: "Afficher un extrait", options: YES_NO_OPTIONS },
    showAllButton: { type: "radio", label: "Bouton « Toutes les actualités »", options: YES_NO_OPTIONS },
    ...OPTIONAL_SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:         "Actualités",
    intro:         "",
    limit:         DEFAULT_LIMIT,
    layout:        "grid",
    showImages:    true,
    showExcerpt:   true,
    showAllButton: false,
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ id, title, intro, limit, layout, showImages, showExcerpt, showAllButton, background, spacing, width, puck }) => {
    const metadata            = readSiteMetadata(puck.metadata)
    const sectionBackground   = background ?? "none"
    const displayedActualites = (metadata.actualites ?? []).slice(0, resolveListingLimit(limit, DEFAULT_LIMIT))
    const withImages          = showImages ?? true
    const withExcerpt         = showExcerpt ?? true
    const selectedLayout      = layout ?? "grid"
    const borderColor         = listingBorderColor(sectionBackground)
    const actualiteHref       = (actualite: SiteActualite) => `/${metadata.slug}/actualites/${actualite.id}`

    if (displayedActualites.length === 0 && !puck.isEditing) return <></>

    const [featuredActualite, ...otherActualites] = displayedActualites

    return (
      // The detail page's "back to site" link lands on #<block id>; scroll-mt-16 keeps the
      // title clear of the sticky h-16 navbar.
      <div id={id} className="scroll-mt-16">
        <SiteBlockSection background={sectionBackground} spacing={spacing} width={width}>
          <SiteListingHeader
            title={title || metadata.ui.actualitesDefaultTitle}
            intro={intro}
            background={sectionBackground}
            showAllLabel={showAllButton ? metadata.ui.actualitesSeeAll : undefined}
            showAllHref={`/${metadata.slug}/actualites`}
            slug={metadata.slug}
          />

          {displayedActualites.length === 0 ? (
            <SiteEditingPlaceholder>Aucune actualité publiée — elles apparaîtront ici automatiquement.</SiteEditingPlaceholder>
          ) : selectedLayout === "list" ? (
            <ul style={{ borderTop: `1px solid ${borderColor}` }}>
              {displayedActualites.map(actualite => (
                <li key={actualite.id} style={{ borderBottom: `1px solid ${borderColor}` }}>
                  <ActualiteRow
                    actualite={actualite}
                    href={actualiteHref(actualite)}
                    background={sectionBackground}
                    withImage={withImages}
                    withExcerpt={withExcerpt}
                    isCompact={false}
                    locale={metadata.locale}
                    featuredBadgeLabel={metadata.ui.actualitesFeaturedBadge}
                  />
                </li>
              ))}
            </ul>
          ) : selectedLayout === "featured" ? (
            <div className={cn("grid gap-8", otherActualites.length > 0 && "lg:grid-cols-5 lg:gap-12")}>
              <Link href={actualiteHref(featuredActualite)} className="group flex flex-col gap-4 lg:col-span-3">
                {withImages && featuredActualite.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={featuredActualite.imageUrl}
                    alt={featuredActualite.title}
                    className="aspect-video w-full object-cover"
                    style={LISTING_IMAGE_RADIUS}
                  />
                )}
                <ActualiteMeta
                  actualite={featuredActualite} background={sectionBackground}
                  locale={metadata.locale} featuredBadgeLabel={metadata.ui.actualitesFeaturedBadge}
                />
                <h3 className="text-2xl leading-tight font-bold tracking-tight text-balance group-hover:underline sm:text-3xl">
                  {featuredActualite.title}
                </h3>
                {withExcerpt && (
                  <p className="line-clamp-4 text-base leading-relaxed" style={mutedTextStyle(sectionBackground)}>
                    {plainTextExcerpt(featuredActualite.content)}
                  </p>
                )}
              </Link>
              {otherActualites.length > 0 && (
                <ul className="lg:col-span-2" style={{ borderTop: `1px solid ${borderColor}` }}>
                  {otherActualites.map(actualite => (
                    <li key={actualite.id} style={{ borderBottom: `1px solid ${borderColor}` }}>
                      <ActualiteRow
                        actualite={actualite}
                        href={actualiteHref(actualite)}
                        background={sectionBackground}
                        withImage={withImages}
                        withExcerpt={false}
                        isCompact
                        locale={metadata.locale}
                        featuredBadgeLabel={metadata.ui.actualitesFeaturedBadge}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {displayedActualites.map(actualite => (
                <Link
                  key={actualite.id}
                  href={actualiteHref(actualite)}
                  className="group flex flex-col overflow-hidden"
                  style={listingCardStyle(sectionBackground)}
                >
                  {withImages && actualite.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={actualite.imageUrl} alt={actualite.title} loading="lazy" className="aspect-video w-full object-cover" />
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <ActualiteMeta
                      actualite={actualite} background={sectionBackground}
                      locale={metadata.locale} featuredBadgeLabel={metadata.ui.actualitesFeaturedBadge}
                    />
                    <h3 className="text-lg leading-snug font-semibold group-hover:underline">{actualite.title}</h3>
                    {withExcerpt && <ActualiteExcerpt actualite={actualite} background={sectionBackground} lineClampClass="line-clamp-3" />}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SiteBlockSection>
      </div>
    )
  },
}

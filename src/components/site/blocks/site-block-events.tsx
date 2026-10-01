import Link from "next/link"
import type { ComponentConfig } from "@puckeditor/core"
import { CalendarBlankIcon, MapPinIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"
import { YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { readSiteMetadata, type SitePuckMetadata } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import {
  SECTION_STYLE_DEFAULTS, SiteBlockSection, mutedTextStyle,
  type SectionBackground, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import {
  LISTING_IMAGE_RADIUS, OPTIONAL_SECTION_STYLE_FIELDS, SiteListingHeader, formatLongDate, formatTime, listingAccentStyle, listingBorderColor,
  listingCardStyle, plainTextExcerpt, resolveListingLimit,
} from "@/components/site/blocks/site-block-listing"

// "Événements à venir": the association's upcoming events, read live from puck.metadata.
// Existing sites only store { title, limit }: every other prop is optional and defaulted in
// render, since Puck defaultProps only apply to newly inserted blocks.

type SiteEvent = SitePuckMetadata["events"][number]

export type EventsLayout  = "grid" | "list"
export type EventsColumns = "2" | "3"

export type EventsBlockProps = Partial<SectionStyleProps> & {
  title:          string
  limit:          number
  intro?:         string
  layout?:        EventsLayout
  columns?:       EventsColumns
  showImages?:    boolean
  showAllButton?: boolean
}

const DEFAULT_LIMIT = 6

const COLUMN_CLASSES: Record<EventsColumns, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
}

// Same rules as the original section: several ticket types → the cheapest available one,
// one ticket type → its price, otherwise the event price when it is not free.
function eventPriceLabel(siteEvent: SiteEvent): string | null {
  if (siteEvent.ticketTypes.length > 1) return `À partir de ${cheapestAvailableTicketTypePrice(siteEvent.ticketTypes).toFixed(2)} €`
  if (siteEvent.ticketTypes.length === 1) return `${Number(siteEvent.ticketTypes[0].price).toFixed(2)} €`
  if (siteEvent.price && Number(siteEvent.price) > 0) return `${Number(siteEvent.price).toFixed(2)} €`
  return null
}

function eventTimeLabel(siteEvent: SiteEvent): string {
  return `${formatTime(siteEvent.date)}${siteEvent.endDate ? ` — ${formatTime(siteEvent.endDate)}` : ""}`
}

function EventDetails({ siteEvent, background }: { siteEvent: SiteEvent; background: SectionBackground }) {
  const priceLabel = eventPriceLabel(siteEvent)
  return (
    <>
      <div className="flex flex-col gap-1 text-sm" style={mutedTextStyle(background)}>
        <span className="flex items-center gap-1.5">
          <CalendarBlankIcon className="size-4 shrink-0" aria-hidden="true" />
          {eventTimeLabel(siteEvent)}
        </span>
        {siteEvent.location && (
          <span className="flex min-w-0 items-center gap-1.5">
            <MapPinIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{siteEvent.location}</span>
          </span>
        )}
      </div>
      {priceLabel && <p className="text-sm font-medium" style={listingAccentStyle(background)}>{priceLabel}</p>}
    </>
  )
}

export const eventsBlock: ComponentConfig<EventsBlockProps> = {
  label: "Événements à venir",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    intro: { type: "textarea", label: "Introduction (facultatif)", contentEditable: true },
    limit: { type: "number", label: "Nombre affiché", min: 1, max: 20 },
    layout: {
      type:    "radio",
      label:   "Présentation",
      options: [{ label: "Grille", value: "grid" }, { label: "Liste", value: "list" }],
    },
    columns: {
      type:    "radio",
      label:   "Colonnes (grille)",
      options: [{ label: "2", value: "2" }, { label: "3", value: "3" }],
    },
    showImages:    { type: "radio", label: "Afficher les images", options: YES_NO_OPTIONS },
    showAllButton: { type: "radio", label: "Bouton « Voir tous les événements »", options: YES_NO_OPTIONS },
    ...OPTIONAL_SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:         "Nos prochains événements",
    intro:         "",
    limit:         DEFAULT_LIMIT,
    layout:        "grid",
    columns:       "3",
    showImages:    true,
    showAllButton: false,
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, limit, layout, columns, showImages, showAllButton, background, spacing, width, puck }) => {
    const metadata          = readSiteMetadata(puck.metadata)
    const sectionBackground = background ?? "none"
    const displayedEvents   = (metadata.events ?? []).slice(0, resolveListingLimit(limit, DEFAULT_LIMIT))
    const withImages        = showImages ?? true

    if (displayedEvents.length === 0 && !puck.isEditing) return <></>

    return (
      <SiteBlockSection background={sectionBackground} spacing={spacing} width={width}>
        <SiteListingHeader
          title={title || "Prochains événements"}
          intro={intro}
          background={sectionBackground}
          showAllLabel={showAllButton ? "Voir tous les événements" : undefined}
          showAllHref={`/${metadata.slug}/evenements`}
          slug={metadata.slug}
        />

        {displayedEvents.length === 0 ? (
          <SiteEditingPlaceholder>Aucun événement à venir — ils apparaîtront ici automatiquement.</SiteEditingPlaceholder>
        ) : (layout ?? "grid") === "list" ? (
          <ul style={{ borderTop: `1px solid ${listingBorderColor(sectionBackground)}` }}>
            {displayedEvents.map(siteEvent => (
              <li key={siteEvent.id} style={{ borderBottom: `1px solid ${listingBorderColor(sectionBackground)}` }}>
                <Link href={`/${metadata.slug}/evenements/${siteEvent.slug ?? siteEvent.id}`} className="group flex gap-5 py-5">
                  <time dateTime={siteEvent.date} className="flex w-14 shrink-0 flex-col items-center pt-0.5 text-center" style={listingAccentStyle(sectionBackground)}>
                    <span className="text-2xl leading-none font-bold">{new Date(siteEvent.date).toLocaleDateString("fr-FR", { day: "numeric" })}</span>
                    <span className="mt-1 text-xs font-medium uppercase">{new Date(siteEvent.date).toLocaleDateString("fr-FR", { month: "short" })}</span>
                  </time>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <h3 className="text-lg leading-snug font-semibold group-hover:underline">{siteEvent.title}</h3>
                    <EventDetails siteEvent={siteEvent} background={sectionBackground} />
                  </div>
                  {withImages && siteEvent.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={siteEvent.imageUrl}
                      alt=""
                      loading="lazy"
                      className="hidden aspect-[4/3] w-40 shrink-0 object-cover sm:block"
                      style={LISTING_IMAGE_RADIUS}
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={cn("grid gap-6", COLUMN_CLASSES[columns ?? "3"] ?? COLUMN_CLASSES["3"])}>
            {displayedEvents.map(siteEvent => {
              const descriptionExcerpt = plainTextExcerpt(siteEvent.description)
              return (
                <Link
                  key={siteEvent.id}
                  href={`/${metadata.slug}/evenements/${siteEvent.slug ?? siteEvent.id}`}
                  className="group flex flex-col overflow-hidden"
                  style={listingCardStyle(sectionBackground)}
                >
                  {withImages && siteEvent.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={siteEvent.imageUrl} alt={siteEvent.title} loading="lazy" className="aspect-video w-full object-cover" />
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <time dateTime={siteEvent.date} className="text-sm font-semibold" style={listingAccentStyle(sectionBackground)}>
                      {formatLongDate(siteEvent.date)}
                    </time>
                    <h3 className="text-lg leading-snug font-semibold group-hover:underline">{siteEvent.title}</h3>
                    {descriptionExcerpt && (
                      <p className="line-clamp-2 text-sm leading-relaxed" style={mutedTextStyle(sectionBackground)}>{descriptionExcerpt}</p>
                    )}
                    <EventDetails siteEvent={siteEvent} background={sectionBackground} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </SiteBlockSection>
    )
  },
}

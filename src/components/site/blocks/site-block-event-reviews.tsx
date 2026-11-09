"use client"

import type { ComponentConfig, CustomField } from "@puckeditor/core"
import { FieldLabel } from "@puckeditor/core"
import { QuotesIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { StarRatingDisplay } from "@/components/ui/star-rating"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"
import { readSiteMetadata, type SiteEventReview } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, isColoredBackground, mutedTextStyle, type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"

// "Avis des événements": real member reviews (EvenementAvis), curated two-step — an admin
// first picks past events on the event's own avaliações page (publicationAgreedAt set +
// featuredOnSite true), then here picks + orders specific reviews from just those events. Never
// shows a reviewer's last name or email — see eventReviewDisplayName in site-block-types.ts.

export type EventReviewsBlockProps = SectionStyleProps & {
  title:    string
  subtitle: string
  eventIds: string[]
  // Optional at the type level only: resolveFields omits this field's editor entirely until at
  // least one event is checked (see below), which TypeScript's Fields<Props> mapping requires
  // reflecting here even though defaultProps always sets a concrete array at runtime.
  reviews?: { avisId: string }[]
}

type DistinctEvent = {
  eventId: string; eventTitle: string; eventDate: string
  eventStatus: SiteEventReview["eventStatus"]; eventVisibility: SiteEventReview["eventVisibility"]
}

function distinctEvents(reviews: SiteEventReview[]): DistinctEvent[] {
  const byEventId = new Map<string, DistinctEvent>()
  for (const review of reviews) {
    if (!byEventId.has(review.eventId)) {
      byEventId.set(review.eventId, {
        eventId: review.eventId, eventTitle: review.eventTitle, eventDate: review.eventDate,
        eventStatus: review.eventStatus, eventVisibility: review.eventVisibility,
      })
    }
  }
  return [...byEventId.values()].sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text
}

// Admin-facing only (this label never reaches the public page) — includes a comment excerpt
// because the displayName alone can't tell two anonymous 5-star reviews of the same event apart.
function reviewOptionLabel(review: SiteEventReview): string {
  const excerpt = review.comment ? ` « ${truncate(review.comment, 40)} »` : ""
  return `${review.displayName} — ${"★".repeat(review.rating)} —${excerpt || ` ${review.eventTitle}`}`
}

function eventWarning(event: DistinctEvent): string | null {
  if (event.eventVisibility === "PRIVATE") return "Événement privé"
  if (event.eventStatus !== "PUBLISHED") return "Événement non publié"
  return null
}

function EventIdsField({
  field, value, onChange, id,
}: { field: CustomField<string[]>; value: string[]; onChange: (value: string[]) => void; id?: string }) {
  const metadata = useSitePuckMetadata()
  const events   = distinctEvents(metadata?.eventReviews ?? [])
  const selected = value ?? []

  return (
    <FieldLabel label={field.label ?? "Événements"} el="div">
      <div id={id} className="flex flex-col gap-1.5 rounded-md border p-2">
        {events.length === 0 && (
          <p className="p-1 text-xs text-muted-foreground">
            Aucun avis sélectionnable pour le moment — sélectionnez d&apos;abord des avis à publier depuis la page « Avis » d&apos;un événement.
          </p>
        )}
        {events.map(event => {
          const warning = eventWarning(event)
          return (
            <CheckboxField
              key={event.eventId}
              id={`event-reviews-event-${event.eventId}`}
              label={(
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span>{event.eventTitle} — {new Date(event.eventDate).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
                  {warning && (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                      <WarningIcon className="size-3.5" weight="fill" />
                      {warning}
                    </span>
                  )}
                </span>
              )}
              checked={selected.includes(event.eventId)}
              onChange={e => onChange(
                e.target.checked ? [...selected, event.eventId] : selected.filter(eventId => eventId !== event.eventId),
              )}
            />
          )
        })}
      </div>
    </FieldLabel>
  )
}

const EVENT_REVIEWS_BASE_FIELDS = {
  title:    { type: "text" as const, label: "Titre", contentEditable: true },
  subtitle: { type: "text" as const, label: "Sous-titre", contentEditable: true },
  eventIds: {
    type:   "custom" as const,
    label:  "Événements",
    render: ({ field, value, onChange, id }: Parameters<CustomField<string[]>["render"]>[0]) => (
      <EventIdsField field={field} value={value} onChange={onChange} id={id} />
    ),
  },
  ...SECTION_STYLE_FIELDS,
}

export const eventReviewsBlock: ComponentConfig<EventReviewsBlockProps> = {
  label:  "Avis des événements",
  fields: EVENT_REVIEWS_BASE_FIELDS,
  // Rebuilds the "avis" picker every time eventIds (or anything else) changes — same pattern
  // already used by site-block-gallery.tsx's resolveFields.
  resolveFields: (data, { metadata }) => {
    const siteMetadata   = readSiteMetadata(metadata)
    const allReviews     = siteMetadata.eventReviews ?? []
    const chosenEventIds = data.props.eventIds ?? []

    // Strict two-step flow: no event picked yet, nothing to curate — the "Avis à afficher"
    // field only appears once at least one event is checked above. Any reviews already saved
    // keep their data (just not editable) until an event is rechecked.
    if (chosenEventIds.length === 0) return EVENT_REVIEWS_BASE_FIELDS

    const eligibleReviews = allReviews.filter(review => chosenEventIds.includes(review.eventId))

    // A review already saved in this block can fall out of the current event selection (its
    // event got unchecked) or lose its site eligibility entirely (unfeatured, consent
    // withdrawn) without the admin touching this block at all. Rather than let the <select>
    // silently show a value that isn't in its options (confusing — the browser just blanks it),
    // keep it visible and clearly flagged instead.
    const savedIds          = new Set((data.props.reviews ?? []).map(item => item.avisId).filter(Boolean))
    const strayEligible     = allReviews.filter(review => savedIds.has(review.id) && !chosenEventIds.includes(review.eventId))
    const stillKnownIds     = new Set([...eligibleReviews, ...strayEligible].map(review => review.id))
    const fullyGoneIds      = [...savedIds].filter(avisId => !stillKnownIds.has(avisId))

    const options = [
      ...eligibleReviews.map(review => ({ label: reviewOptionLabel(review), value: review.id })),
      ...strayEligible.map(review => ({ label: `${reviewOptionLabel(review)} — hors de la sélection d'événements`, value: review.id })),
      ...fullyGoneIds.map(avisId => ({ label: "Avis non disponible (retiré de la sélection du site)", value: avisId })),
    ]

    return {
      ...EVENT_REVIEWS_BASE_FIELDS,
      reviews: {
        type:  "array",
        label: "Avis à afficher (glisser pour réordonner)",
        max:   12,
        arrayFields: {
          avisId: {
            type:    "select",
            label:   "Avis",
            options: options.length > 0 ? options : [{ label: "Aucun avis disponible pour ces événements", value: "" }],
          },
        },
        defaultItemProps: { avisId: eligibleReviews[0]?.id ?? "" },
        getItemSummary:   (item: { avisId: string }) => {
          if (!item.avisId) return "Avis à choisir"
          const review = allReviews.find(r => r.id === item.avisId)
          return review ? reviewOptionLabel(review) : "Avis non disponible"
        },
      },
    }
  },
  defaultProps: {
    title:    "Ils en parlent",
    subtitle: "",
    eventIds: [],
    reviews:  [],
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, subtitle, reviews, background, textColor, spacing, width, puck }) => {
    const metadata      = readSiteMetadata(puck.metadata)
    const reviewsById    = new Map(metadata.eventReviews.map(review => [review.id, review]))
    // Drops any id no longer eligible (unfeatured, consent withdrawn…) — the review then just
    // disappears from this block on the next render, without needing to prune the saved data.
    const resolvedReviews = (reviews ?? [])
      .map(item => reviewsById.get(item.avisId))
      .filter((review): review is SiteEventReview => !!review)

    if (resolvedReviews.length === 0 && !puck.isEditing) return <></>

    const dividerColor = isColoredBackground(background) ? "color-mix(in srgb, currentColor 25%, transparent)" : "var(--site-border)"
    // Never force 3 columns when there are only 1 or 2 cards — that leaves a dangling empty
    // third of the row. Caps at the actual count instead.
    const columnCount    = Math.min(3, resolvedReviews.length) || 1
    const gridColsClass  = columnCount === 1 ? "md:grid-cols-1" : columnCount === 2 ? "md:grid-cols-2" : "md:grid-cols-3"

    return (
      <SiteBlockSection background={background} textColor={textColor} spacing={spacing} width={width}>
        {(title || subtitle) && (
          <div className="mb-10 text-center">
            {title && <h2 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>}
            {subtitle && <p className="mt-3 text-base" style={mutedTextStyle(background, textColor)}>{subtitle}</p>}
          </div>
        )}

        {resolvedReviews.length === 0 ? (
          <SiteEditingPlaceholder>Aucun avis sélectionné — choisissez des événements puis des avis à afficher.</SiteEditingPlaceholder>
        ) : (
          <div className={cn("grid grid-cols-1", gridColsClass)}>
            {resolvedReviews.map((review, itemIndex) => {
              const col = itemIndex % columnCount
              const row = Math.floor(itemIndex / columnCount)
              return (
                <figure
                  key={review.id}
                  className={cn(
                    "flex flex-col gap-4 p-6 md:p-8",
                    itemIndex > 0 && "border-t md:border-t-0",
                    col !== 0 && "md:border-l",
                    row > 0 && "md:border-t",
                  )}
                  style={{ borderColor: dividerColor }}
                >
                  <div className="flex items-center justify-between">
                    <QuotesIcon className="size-6 opacity-60" weight="fill" />
                    <StarRatingDisplay value={review.rating} size="sm" />
                  </div>
                  {review.comment && <blockquote className="text-sm leading-relaxed text-pretty">« {review.comment} »</blockquote>}
                  <figcaption className="mt-auto flex flex-col text-sm">
                    <span className="font-semibold">{review.displayName}</span>
                    <span style={mutedTextStyle(background, textColor)}>
                      {review.eventTitle} · {new Date(review.eventDate).toLocaleDateString(metadata.locale, { month: "long", year: "numeric" })}
                    </span>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        )}
      </SiteBlockSection>
    )
  },
}

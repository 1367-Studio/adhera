import type { ComponentConfig, Fields } from "@puckeditor/core"
import Autoplay from "embla-carousel-autoplay"
import { YES_NO_OPTIONS, imageField } from "@/components/site/blocks/site-block-fields"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, mutedTextStyle,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel"
import { cn } from "@/lib/utils"

const AUTOPLAY_DELAY_MS = 4000

// "Galerie": a static photo grid, or a swipeable carousel. Each photo opens full size
// in a new tab; no lightbox JS.

export type GalleryImage = { image: string; alt: string; caption: string }
export type GalleryColumns = "2" | "3" | "4"
export type GalleryAspect = "square" | "original"
export type GalleryDisplayMode = "grid" | "carousel"

export type GalleryBlockProps = SectionStyleProps & {
  title:       string
  images:      GalleryImage[]
  displayMode: GalleryDisplayMode
  columns:     GalleryColumns
  aspect:      GalleryAspect
  // Optional: resolveFields below hides this control (and so never sends it back) in grid mode.
  autoplay?:   boolean
}

const GRID_CLASSES: Record<GalleryColumns, string> = {
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-2 md:grid-cols-3",
  "4": "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
}

const CAROUSEL_BASIS_CLASSES: Record<GalleryColumns, string> = {
  "2": "basis-full sm:basis-1/2",
  "3": "basis-1/2 md:basis-1/3",
  "4": "basis-1/2 md:basis-1/3 lg:basis-1/4",
}

const GALLERY_FIELDS: Fields<GalleryBlockProps> = {
  title: { type: "text", label: "Titre", contentEditable: true },
  images: {
    type:             "array",
    label:            "Photos",
    max:              30,
    arrayFields: {
      image:   imageField("Photo"),
      alt:     { type: "text", label: "Description (accessibilité)" },
      caption: { type: "text", label: "Légende (facultatif)" },
    },
    defaultItemProps: { image: "", alt: "", caption: "" },
    getItemSummary:   (galleryImage, imageIndex) =>
      galleryImage.caption || galleryImage.alt || `Photo ${(imageIndex ?? 0) + 1}`,
  },
  displayMode: {
    type:    "radio",
    label:   "Affichage",
    options: [
      { label: "Grille",    value: "grid" },
      { label: "Carrousel", value: "carousel" },
    ],
  },
  columns: {
    type:    "radio",
    label:   "Colonnes",
    options: [
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
    ],
  },
  aspect: {
    type:    "radio",
    label:   "Format",
    options: [
      { label: "Carré",    value: "square" },
      { label: "Original", value: "original" },
    ],
  },
  autoplay: { type: "radio", label: "Défilement automatique", options: YES_NO_OPTIONS },
  ...SECTION_STYLE_FIELDS,
}

export const galleryBlock: ComponentConfig<GalleryBlockProps> = {
  label:  "Galerie",
  fields: GALLERY_FIELDS,
  // "Défilement automatique" only means something in carousel mode — hide it in grid mode.
  resolveFields: galleryData => {
    if (galleryData.props.displayMode === "carousel") return GALLERY_FIELDS
    const visibleFields = { ...GALLERY_FIELDS }
    delete visibleFields.autoplay
    return visibleFields
  },
  defaultProps: {
    title:       "En images",
    images:      [],
    displayMode: "grid",
    columns:     "3",
    aspect:      "square",
    autoplay:    false,
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, images, displayMode, columns, aspect, autoplay = false, background, textColor, spacing, width, puck }) => {
    const visibleImages = images.filter(galleryImage => galleryImage.image)
    const isSquare       = aspect === "square"
    const isCarousel     = displayMode === "carousel"

    const photo = (galleryImage: GalleryImage) => (
      <figure>
        <a
          href={galleryImage.image}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden"
          style={{ borderRadius: "var(--site-radius)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={galleryImage.image}
            alt={galleryImage.alt || galleryImage.caption || ""}
            loading="lazy"
            className={cn("w-full transition-opacity hover:opacity-90", isSquare ? "aspect-square object-cover" : "h-auto object-contain")}
          />
        </a>
        {galleryImage.caption && (
          <figcaption className="mt-2 text-sm" style={mutedTextStyle(background, textColor)}>{galleryImage.caption}</figcaption>
        )}
      </figure>
    )

    return (
      <SiteBlockSection background={background} textColor={textColor} spacing={spacing} width={width}>
        {title && <h2 className="mb-8 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}

        {visibleImages.length === 0 && puck.isEditing && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
          >
            Ajoutez des photos dans le panneau de droite.
          </div>
        )}

        {visibleImages.length > 0 && isCarousel && (
          <Carousel
            opts={{ align: "start", watchDrag: !puck.isEditing }}
            plugins={autoplay && visibleImages.length > 1 ? [Autoplay({ delay: AUTOPLAY_DELAY_MS, stopOnInteraction: true })] : undefined}
            className={visibleImages.length > 1 ? "px-10" : undefined}
          >
            <CarouselContent className={!isSquare ? "items-start" : undefined}>
              {visibleImages.map((galleryImage, imageIndex) => (
                <CarouselItem key={imageIndex} className={CAROUSEL_BASIS_CLASSES[columns]}>
                  {photo(galleryImage)}
                </CarouselItem>
              ))}
            </CarouselContent>
            {visibleImages.length > 1 && (
              <>
                <CarouselPrevious className="left-0" />
                <CarouselNext className="right-0" />
              </>
            )}
          </Carousel>
        )}

        {visibleImages.length > 0 && !isCarousel && (
          <ul className={cn("grid gap-4", GRID_CLASSES[columns], !isSquare && "items-start")}>
            {visibleImages.map((galleryImage, imageIndex) => (
              <li key={imageIndex}>{photo(galleryImage)}</li>
            ))}
          </ul>
        )}
      </SiteBlockSection>
    )
  },
}
